//! MCP über stdin/stdout — nur in der Desktop-App.
//!
//! Der Paneldienst spricht MCP ausschließlich über HTTPS (`services/mcp/`).
//! Ein lokales Programm, das MCP über stdin/stdout anbietet, kann nur dort
//! laufen, wo der Mensch sitzt: in dieser App. Der Befehl startet den
//! konfigurierten Prozess **ohne Shell**, mit einer festen, kleinen Umgebung
//! und einem temporären Arbeitsverzeichnis. Es gibt keine Argumentliste, die
//! eine Shell ausführen könnte, und keine Umgebungsvariable des Panels.
//!
//! Jeder Aufruf ist eine eigene Sitzung: `initialize`, die Meldung
//! `notifications/initialized`, dann die eigentlichen Anfragen. Der Prozess
//! wird nach der letzten Antwort beendet; ein hängender oder antwortloser
//! Prozess wird von der Frist beendet. Beim Beenden der App nimmt
//! `alle_beenden` alles mit, was noch läuft.
//!
//! Grenzen: höchstens acht Nachrichten je Aufruf, 64 KiB je Nachricht,
//! 1 MiB je Antwortzeile, 4 MiB zusammen, Frist 1 bis 120 Sekunden.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

const HOECHSTENS_NACHRICHTEN: usize = 8;
const HOECHSTENS_NACHRICHT: usize = 64 * 1024;
const HOECHSTENS_ZEILE: usize = 1024 * 1024;
const HOECHSTENS_ANTWORT: usize = 4 * 1024 * 1024;
const HOECHSTENS_BEFEHL: usize = 1024;
const HOECHSTENS_ARGUMENTE: usize = 64;
const HOECHSTENS_ARGUMENT: usize = 4096;
const FRIST_STANDARD_MS: u64 = 30_000;
const FRIST_MIN_MS: u64 = 1_000;
const FRIST_MAX_MS: u64 = 120_000;

#[derive(Debug, Deserialize)]
pub struct StdioAnfrage {
    /// Das Programm, so wie es konfiguriert wurde. Kein Shell-Aufruf.
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// Die JSON-RPC-Nachrichten in Reihenfolge.
    pub nachrichten: Vec<Value>,
    #[serde(default)]
    pub frist_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct StdioAntwort {
    pub antworten: Vec<Value>,
}

struct Lauf {
    kind: Arc<Mutex<Child>>,
    ordner: PathBuf,
}

static NAECHSTE: AtomicU64 = AtomicU64::new(1);
static LAEUFE: OnceLock<Mutex<HashMap<u64, Lauf>>> = OnceLock::new();

fn laeufe() -> &'static Mutex<HashMap<u64, Lauf>> {
    LAEUFE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn eintragen(id: u64, kind: Arc<Mutex<Child>>, ordner: PathBuf) {
    if let Ok(mut alle) = laeufe().lock() {
        alle.insert(id, Lauf { kind, ordner });
    }
}

fn austragen(id: u64) -> Option<Lauf> {
    laeufe().lock().ok().and_then(|mut alle| alle.remove(&id))
}

/// Beendet alle noch laufenden MCP-Prozesse. Wird beim Beenden der App
/// gerufen; ein hängender Prozess soll den Rechner nicht überleben.
pub fn alle_beenden() {
    let Ok(mut alle) = laeufe().lock() else {
        return;
    };
    for (_, lauf) in alle.drain() {
        if let Ok(mut kind) = lauf.kind.lock() {
            let _ = kind.kill();
            let _ = kind.wait();
        }
        let _ = std::fs::remove_dir_all(&lauf.ordner);
    }
}

/// Nur die Umgebung, die ein Programm zum Starten braucht. Kein Panel-Token,
/// kein Schlüssel, keine Pfade aus dem Panel.
fn minimale_umgebung(kommando: &mut Command) {
    kommando.env_clear();
    #[cfg(windows)]
    let namen: &[&str] = &[
        "PATH",
        "PATHEXT",
        "SystemRoot",
        "WINDIR",
        "TEMP",
        "TMP",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "COMSPEC",
        "LANG",
        "HOME",
    ];
    #[cfg(not(windows))]
    let namen: &[&str] = &["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"];
    for name in namen {
        if let Ok(wert) = std::env::var(name) {
            kommando.env(name, wert);
        }
    }
}

/// Liest aus `leser` bis zu der Antwort, deren `id` zu `erwartet` passt.
/// Hinweise ohne `id` und Antworten auf andere Anfragen werden übersprungen.
fn antwort_lesen<R: BufRead>(leser: &mut R, erwartet: &Value) -> Result<Value, String> {
    loop {
        let mut zeile = String::new();
        let gelesen = (&mut *leser)
            .take(HOECHSTENS_ZEILE as u64 + 1)
            .read_line(&mut zeile)
            .map_err(|e| format!("Antwort konnte nicht gelesen werden: {e}"))?;
        if gelesen == 0 {
            return Err("Der MCP-Prozess hat die Verbindung geschlossen.".into());
        }
        if zeile.len() > HOECHSTENS_ZEILE {
            return Err("Die Antwort des MCP-Prozesses ist zu groß.".into());
        }
        let zeile = zeile.trim();
        if zeile.is_empty() {
            continue;
        }
        let wert: Value = serde_json::from_str(zeile)
            .map_err(|_| "Der MCP-Prozess hat keine JSON-Antwort geschickt.".to_string())?;
        if wert.get("id") == Some(erwartet) {
            return Ok(wert);
        }
    }
}

fn sitzung(
    anfrage: &StdioAnfrage,
    mut eingabe: ChildStdin,
    ausgabe: impl Read + Send + 'static,
    frist: Duration,
) -> Result<Vec<Value>, String> {
    let (sender, empfaenger) = mpsc::channel::<Result<Vec<Value>, String>>();
    let nachrichten = anfrage.nachrichten.clone();
    std::thread::spawn(move || {
        let mut leser = BufReader::new(ausgabe);
        let mut antworten = Vec::new();
        let mut gesamt = 0usize;
        for nachricht in nachrichten {
            let mut zeile = match serde_json::to_vec(&nachricht) {
                Ok(z) => z,
                Err(e) => {
                    let _ = sender.send(Err(format!("Anfrage nicht schreibbar: {e}")));
                    return;
                }
            };
            zeile.push(b'\n');
            if let Err(e) = eingabe.write_all(&zeile).and_then(|_| eingabe.flush()) {
                let _ = sender.send(Err(format!("MCP-Prozess nimmt keine Anfrage an: {e}")));
                return;
            }
            let id = match nachricht.get("id") {
                Some(id) => id.clone(),
                None => continue,
            };
            match antwort_lesen(&mut leser, &id) {
                Ok(antwort) => {
                    gesamt += serde_json::to_string(&antwort).map(|t| t.len()).unwrap_or(0);
                    if gesamt > HOECHSTENS_ANTWORT {
                        let _ = sender.send(Err("Die Antworten des MCP-Prozesses sind zu groß.".into()));
                        return;
                    }
                    antworten.push(antwort);
                }
                Err(fehler) => {
                    let _ = sender.send(Err(fehler));
                    return;
                }
            }
        }
        let _ = sender.send(Ok(antworten));
    });

    match empfaenger.recv_timeout(frist) {
        Ok(ergebnis) => ergebnis,
        Err(mpsc::RecvTimeoutError::Timeout) => Err("Zeitüberschreitung beim MCP-Prozess.".into()),
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err("Der MCP-Prozess hat ohne Antwort geendet.".into())
        }
    }
}

fn pruefen(anfrage: &StdioAnfrage) -> Result<Duration, String> {
    let befehl = anfrage.command.trim();
    if befehl.is_empty() {
        return Err("Kein Programm angegeben.".into());
    }
    if befehl.len() > HOECHSTENS_BEFEHL {
        return Err("Der Programmname ist zu lang.".into());
    }
    if anfrage.args.len() > HOECHSTENS_ARGUMENTE {
        return Err("Zu viele Argumente für den MCP-Prozess.".into());
    }
    if anfrage.args.iter().any(|a| a.len() > HOECHSTENS_ARGUMENT) {
        return Err("Ein Argument für den MCP-Prozess ist zu lang.".into());
    }
    if anfrage.nachrichten.is_empty() || anfrage.nachrichten.len() > HOECHSTENS_NACHRICHTEN {
        return Err("Ungültige Zahl von MCP-Nachrichten.".into());
    }
    for nachricht in &anfrage.nachrichten {
        let groesse = serde_json::to_vec(nachricht).map(|b| b.len()).unwrap_or(usize::MAX);
        if groesse > HOECHSTENS_NACHRICHT {
            return Err("Eine MCP-Nachricht ist zu groß.".into());
        }
    }
    let ms = anfrage.frist_ms.unwrap_or(FRIST_STANDARD_MS).clamp(FRIST_MIN_MS, FRIST_MAX_MS);
    Ok(Duration::from_millis(ms))
}

fn lauf(anfrage: &StdioAnfrage) -> Result<StdioAntwort, String> {
    if cfg!(target_os = "android") {
        return Err("Lokale MCP-Programme gibt es nur in der Desktop-App.".into());
    }
    let frist = pruefen(anfrage)?;
    let id = NAECHSTE.fetch_add(1, Ordering::Relaxed);
    let ordner = std::env::temp_dir().join(format!("msm-mcp-{}-{id}", std::process::id()));
    std::fs::create_dir_all(&ordner)
        .map_err(|e| format!("Arbeitsverzeichnis nicht anlegbar: {e}"))?;

    let mut kommando = Command::new(anfrage.command.trim());
    kommando
        .args(&anfrage.args)
        .current_dir(&ordner)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    minimale_umgebung(&mut kommando);
    let mut kind = kommando
        .spawn()
        .map_err(|e| format!("MCP-Prozess startet nicht: {e}"))?;
    let eingabe = kind
        .stdin
        .take()
        .ok_or_else(|| "MCP-Prozess hat keine Eingabe.".to_string())?;
    let ausgabe = kind
        .stdout
        .take()
        .ok_or_else(|| "MCP-Prozess hat keine Ausgabe.".to_string())?;
    let kind = Arc::new(Mutex::new(kind));
    eintragen(id, Arc::clone(&kind), ordner.clone());

    let ergebnis = sitzung(anfrage, eingabe, ausgabe, frist);

    if let Some(lauf) = austragen(id) {
        if let Ok(mut kind) = lauf.kind.lock() {
            let _ = kind.kill();
            let _ = kind.wait();
        }
        let _ = std::fs::remove_dir_all(&lauf.ordner);
    }
    ergebnis.map(|antworten| StdioAntwort { antworten })
}

/// Führt eine kurze MCP-Sitzung über stdin/stdout aus. Die Oberfläche ruft
/// das nur in der Desktop-App auf; das Panel kennt diesen Weg nicht.
#[tauri::command(async)]
pub fn mcp_stdio(anfrage: StdioAnfrage) -> Result<StdioAntwort, String> {
    lauf(&anfrage)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use serde_json::json;

    fn anfrage(command: &str, args: Vec<&str>, nachrichten: Vec<Value>, frist_ms: u64) -> StdioAnfrage {
        StdioAnfrage {
            command: command.into(),
            args: args.into_iter().map(str::to_string).collect(),
            nachrichten,
            frist_ms: Some(frist_ms),
        }
    }

    #[test]
    fn liest_nur_die_antwort_zu_der_eigenen_kennung() {
        let eingabe = Cursor::new(
            concat!(
                "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/message\",\"params\":{}}\n",
                "{\"jsonrpc\":\"2.0\",\"id\":99,\"result\":{\"fremd\":true}}\n",
                "{\"jsonrpc\":\"2.0\",\"id\":7,\"result\":{\"ok\":true}}\n",
            )
            .as_bytes()
            .to_vec(),
        );
        let mut leser = BufReader::new(eingabe);
        let antwort = antwort_lesen(&mut leser, &json!(7)).unwrap();
        assert_eq!(antwort["result"]["ok"], json!(true));
    }

    #[test]
    fn eine_zu_grosse_zeile_wird_abgelehnt() {
        let mut daten = vec![b' '; HOECHSTENS_ZEILE + 10];
        daten.push(b'\n');
        let mut leser = BufReader::new(Cursor::new(daten));
        let fehler = antwort_lesen(&mut leser, &json!(1)).unwrap_err();
        assert!(fehler.contains("zu groß"), "{fehler}");
    }

    #[test]
    fn ohne_programm_wird_abgelehnt() {
        let fehler = lauf(&anfrage("", vec![], vec![json!({"id":1})], 1000)).unwrap_err();
        assert!(fehler.contains("Kein Programm"), "{fehler}");
    }

    #[test]
    fn eine_geschlossene_verbindung_ist_ein_fehler() {
        let mut leser = BufReader::new(Cursor::new(Vec::new()));
        let fehler = antwort_lesen(&mut leser, &json!(1)).unwrap_err();
        assert!(fehler.contains("geschlossen"), "{fehler}");
    }

    fn python() -> Option<&'static str> {
        for kandidat in ["python3", "python"] {
            if Command::new(kandidat)
                .arg("--version")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
            {
                return Some(kandidat);
            }
        }
        None
    }

    fn mock_pfad() -> PathBuf {
        let pfad = std::env::temp_dir().join(format!("mock_mcp_{}.py", std::process::id()));
        std::fs::write(&pfad, include_str!("../tests/mock_mcp.py")).unwrap();
        pfad
    }

    #[test]
    fn beantwortet_zwei_nachrichten_und_beendet_den_prozess() {
        let Some(py) = python() else {
            eprintln!("übersprungen: kein Python für den Mock-MCP-Server");
            return;
        };
        let skript = mock_pfad();
        let ergebnis = lauf(&anfrage(
            py,
            vec![skript.to_str().unwrap(), "antwort"],
            vec![
                json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}),
                json!({"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}),
            ],
            10_000,
        ))
        .unwrap();
        assert_eq!(ergebnis.antworten.len(), 2);
        assert_eq!(ergebnis.antworten[1]["result"]["tools"][0]["name"], json!("echo"));
        let _ = std::fs::remove_file(skript);
    }

    #[test]
    fn die_frist_beendet_einen_haengenden_prozess() {
        let Some(py) = python() else {
            eprintln!("übersprungen: kein Python für den Mock-MCP-Server");
            return;
        };
        let skript = mock_pfad();
        let start = std::time::Instant::now();
        let fehler = lauf(&anfrage(
            py,
            vec![skript.to_str().unwrap(), "haengen"],
            vec![json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}})],
            1_000,
        ))
        .unwrap_err();
        assert!(fehler.contains("Zeitüberschreitung"), "{fehler}");
        assert!(start.elapsed() < Duration::from_secs(10), "Frist griff nicht");
        let _ = std::fs::remove_file(skript);
    }
}
