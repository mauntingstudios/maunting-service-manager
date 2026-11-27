from __future__ import annotations

import json
import math
import re
import threading
from collections import Counter

from services import ai_embedding_service
from services.ai_tool_registry import WERKZEUGE
from services.tool_selection_port import HOTSET


def _tool_searchable(name: str, schema: dict | None) -> str:
    desc = ""
    params = ""
    if schema:
        func = schema.get("function", schema) if isinstance(schema, dict) else {}
        desc = func.get("description", "") if isinstance(func, dict) else ""
        parameters = func.get("parameters", {}) if isinstance(func, dict) else {}
        props = parameters.get("properties", {}) if isinstance(parameters, dict) else {}
        if isinstance(props, dict):
            parts = []
            for k, v in props.items():
                if isinstance(v, dict):
                    d = v.get("description", "")
                    parts.append(f"{k}: {d}")
            params = " ".join(parts)
    return f"{name}: {desc} {params}".strip()


#: Woerter, die in fast jeder Anfrage und Beschreibung stehen und nichts
#: unterscheiden. Ohne die Liste zog "auf dem Minecraft-Server" jedes
#: Werkzeug nach vorn, das "auf" und "dem" in der Beschreibung hat.
_FUELLWOERTER = frozenset(
    "der die das den dem des ein eine einen einem einer eines und oder auf in im "
    "an am zu zum zur mit von vom fuer bei aus als ist sind wird werden nicht "
    "kein keine nur auch noch bitte mal mir mich mein meine meinen dir du ich "
    "er sie es wir ihr ihm ihn dann jetzt einfach schon mach mache machen gib "
    "gebe kannst soll sollst will moechte möchte lass the a an of to for and "
    "or is on with".split()
)
#: Ohne "er": "Server" ist kein gebeugtes "Serv".
_ENDUNGEN = ("en", "es", "e", "n", "s", "t")


def _stamm(wort: str) -> str:
    """Grob der Wortstamm: "erstelle", "erstellen", "erstellt" -> "erstell".

    Kein Sprachmodell, nur so viel, dass die Beugung den Treffer nicht
    verhindert. Umlaute werden gefaltet, weil die Beschreibungen beide
    Schreibweisen fuehren ("fuer" und "für").
    """
    wort = (
        wort.lower()
        .replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    )
    for endung in _ENDUNGEN:
        if wort.endswith(endung) and len(wort) - len(endung) >= 4:
            return wort[: -len(endung)]
    return wort


def _stämme(text: str) -> list[str]:
    return [
        # Ohne Unterstrich: der Werkzeugname steht vorn in jedem Suchtext,
        # und "propose_server_delete" als ein Wort traf nie "Server".
        _stamm(w) for w in re.findall(r"[^\W_]+", text.lower())
        if w not in _FUELLWOERTER and len(w) > 1
    ]


def _bm25_score(query: str, doc: str, idf: dict[str, float] | None = None) -> float:
    """BM25 mit Stamm, Fuellwortliste und — wenn gegeben — Seltenheit.

    Ein Stamm ab fuenf Zeichen trifft auch als Ende eines zusammengesetzten
    Worts: "Rechte" findet "Serverrechte". Bis zum 25.09.2026 zaehlte nur das
    genaue Wort mit gleichem Gewicht, und "gib ihm die Rechte auf dem
    Minecraft-Server" fand keines der Rechtewerkzeuge.
    """
    q_terms = _stämme(query)
    d_terms = _stämme(doc)
    if not q_terms or not d_terms:
        return 0.0
    counter = Counter(d_terms)
    n = len(d_terms)
    score = 0.0
    for t in q_terms:
        tf = counter.get(t, 0)
        if len(t) >= 5:
            tf += sum(anzahl for wort, anzahl in counter.items() if wort != t and wort.endswith(t))
        if tf == 0:
            continue
        gewicht = idf.get(t, 1.0) if idf is not None else 1.0
        score += gewicht * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * n / 20))
    return score / (len(q_terms) * 2)


def _seltenheit(query: str, docs: list[str]) -> dict[str, float]:
    """Wie selten jeder Stamm der Anfrage in den Beschreibungen ist.

    "Server" steht in fast jeder Beschreibung und entscheidet deshalb nichts,
    "Rolle" in einer Handvoll.
    """
    stamm_mengen = [set(_stämme(d)) for d in docs]
    gesamt = len(docs)
    ergebnis: dict[str, float] = {}
    for t in set(_stämme(query)):
        df = sum(
            1 for menge in stamm_mengen
            if t in menge or (len(t) >= 5 and any(w.endswith(t) for w in menge))
        )
        ergebnis[t] = math.log((gesamt - df + 0.5) / (df + 0.5) + 1.0)
    return ergebnis


def _cosine(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return max(-1.0, min(1.0, dot / (na * nb)))


#: Wie viele Werkzeuge die Gruppen der Treffer hoechstens nachziehen. Die
#: groesste Gruppe (Benutzer und Rollen) hat sieben; die Grenze haelt fuenf
#: Treffer aus fuenf Gruppen davon ab, den Katalog wieder aufzublasen.
MAX_GRUPPEN_NACHZUG = 12


def gruppen_nachbarn(treffer: list[str], allowed: frozenset[str]) -> list[str]:
    """Die uebrigen Werkzeuge der Gruppen, die die Suche getroffen hat.

    Die Suche waehlt fuenf Werkzeuge nach Textaehnlichkeit, und ein Auftrag
    braucht oft ein Werkzeug, das sie nicht fand: "gib ihm die Rolle
    Moderator" trifft `propose_role_delete`, gebraucht werden `list_users`
    und `propose_user_roles` (Betreibertest vom 25.09.2026 — der Worker
    hatte kein Werkzeug, um eine Rolle anzulegen). Werkzeuge ohne Gruppe
    ziehen nichts nach; der Rest der Registry ist zu gross dafuer.
    """
    gesehen = set(treffer)
    nachbarn: list[str] = []
    for name in treffer:
        spec = WERKZEUGE.get(name)
        if spec is None or not spec.gruppe:
            continue
        for anderer, anderer_spec in WERKZEUGE.items():
            if (
                anderer_spec.gruppe == spec.gruppe
                and anderer in allowed
                and anderer not in gesehen
            ):
                if len(nachbarn) >= MAX_GRUPPEN_NACHZUG:
                    return nachbarn
                nachbarn.append(anderer)
                gesehen.add(anderer)
    return nachbarn


class SemanticToolRouterAdapter:
    def __init__(self, tool_schemas: dict[str, dict] | None = None):
        self._schemas: dict[str, dict] = tool_schemas or {}
        self._searchable: dict[str, str] = {}
        self._token_counts: dict[str, Counter[str]] = {}
        self._doc_lengths: dict[str, int] = {}
        self._doc_term_sets: dict[str, set[str]] = {}
        self._name_stems: dict[str, list[str]] = {}
        self._vectors: dict[str, list[float]] | None = None
        # Modell der Werkzeugvektoren; Frage und Index müssen aus demselben stammen.
        self._vectors_modell: str | None = None
        self._ready = False
        self._lock = threading.RLock()

    def _index_text_features(self, name: str, doc: str) -> None:
        self._searchable[name] = doc
        d_terms = _stämme(doc)
        self._token_counts[name] = Counter(d_terms)
        self._doc_lengths[name] = len(d_terms)
        self._doc_term_sets[name] = set(d_terms)
        self._name_stems[name] = [
            t for t in _stämme(name.replace("_", " ")) if t != "propos"
        ]

    def _ensure_index(self, allowed: frozenset[str]) -> None:
        with self._lock:
            needed = sorted({n for n in allowed if n not in self._searchable})
            missing_vectors = False
            if self._vectors is not None:
                missing_vectors = any(
                    n not in self._vectors for n in allowed if n in self._searchable
                )
            if not needed and not missing_vectors:
                return
            for name in needed:
                schema = self._schemas.get(name)
                if schema is None:
                    try:
                        from services import ai_action_service

                        for e in (
                            ai_action_service.provider_tool_definitions()
                            + ai_action_service.voice_control_tool_definitions()
                        ):
                            func = e.get("function", e) if isinstance(e, dict) else {}
                            if func.get("name") == name:
                                schema = e
                                break
                    except Exception:
                        schema = None
                self._index_text_features(name, _tool_searchable(name, schema))
            if ai_embedding_service.is_ready():
                to_encode = needed
                if missing_vectors and not needed:
                    to_encode = sorted(
                        {n for n in allowed if n not in (self._vectors or {})}
                    )
                if to_encode:
                    texts = [self._searchable[n] for n in to_encode]
                    kodierung = ai_embedding_service.encode(texts)
                    if kodierung is not None and len(kodierung.vektoren) == len(to_encode):
                        if self._vectors is None or self._vectors_modell != kodierung.modell:
                            self._vectors = {}
                            self._vectors_modell = kodierung.modell
                            if len(to_encode) < len(allowed):
                                all_allowed = sorted(allowed)
                                full_kod = ai_embedding_service.encode(
                                    [self._searchable[n] for n in all_allowed]
                                )
                                if (
                                    full_kod is not None
                                    and len(full_kod.vektoren) == len(all_allowed)
                                    and full_kod.modell == kodierung.modell
                                ):
                                    to_encode = all_allowed
                                    kodierung = full_kod
                        for n, v in zip(to_encode, kodierung.vektoren):
                            self._vectors[n] = v
                        self._ready = True

    def warm(self, allowed: frozenset[str]) -> None:
        self._ensure_index(allowed)

    def select(self, query: str, allowed: frozenset[str], top_k: int = 5) -> list[str]:
        if not query or not query.strip() or not allowed:
            return []
        query = query.strip()
        with self._lock:
            self._ensure_index(allowed)
            hot_in_allowed = [n for n in HOTSET if n in allowed]
            candidates = sorted([n for n in allowed if n not in hot_in_allowed])
            if not candidates:
                return []
            q_vec = None
            if self._vectors is not None:
                qv = ai_embedding_service.encode([query])
                if qv is not None and qv.vektoren:
                    if qv.modell == self._vectors_modell:
                        q_vec = qv.vektoren[0]
                    else:
                        # Modellraum gewechselt: Index sofort im neuen Raum neu aufbauen.
                        self._vectors = None
                        self._vectors_modell = None
                        self._ensure_index(allowed)
                        if (
                            self._vectors is not None
                            and qv.modell == self._vectors_modell
                        ):
                            q_vec = qv.vektoren[0]

            q_terms = _stämme(query)
            anfrage = set(q_terms)
            gesamt = len(candidates)
            idf: dict[str, float] = {}
            for t in anfrage:
                is_long = len(t) >= 5
                df = 0
                for n in candidates:
                    menge = self._doc_term_sets.get(n)
                    if menge is None:
                        menge = set(_stämme(self._searchable.get(n, n)))
                    if t in menge or (is_long and any(w.endswith(t) for w in menge)):
                        df += 1
                idf[t] = math.log((gesamt - df + 0.5) / (df + 0.5) + 1.0)

            scored: list[tuple[float, str]] = []
            max_bm25 = 0.0
            bm25_scores: dict[str, float] = {}
            q_norm = len(q_terms) * 2
            for name in candidates:
                counter = self._token_counts.get(name)
                d_len = self._doc_lengths.get(name, 0)
                if counter is None:
                    d_terms = _stämme(self._searchable.get(name, name))
                    counter = Counter(d_terms)
                    d_len = len(d_terms)
                if not q_terms or not d_len:
                    s = 0.0
                else:
                    s = 0.0
                    denom_len = 1.2 * (0.25 + 0.75 * d_len / 20)
                    for t in q_terms:
                        tf = counter.get(t, 0)
                        if len(t) >= 5:
                            tf += sum(
                                anzahl
                                for wort, anzahl in counter.items()
                                if wort != t and wort.endswith(t)
                            )
                        if tf == 0:
                            continue
                        s += idf.get(t, 1.0) * (tf * 2.2) / (tf + denom_len)
                    s /= q_norm
                bm25_scores[name] = s
                if s > max_bm25:
                    max_bm25 = s

            for name in candidates:
                bm25 = bm25_scores[name] / max_bm25 if max_bm25 > 0 else 0
                cos = 0.0
                if q_vec is not None and self._vectors and name in self._vectors:
                    cos = _cosine(q_vec, self._vectors[name])
                    cos = (cos + 1.0) / 2.0
                teile = self._name_stems.get(name)
                if teile is None:
                    teile = [t for t in _stämme(name.replace("_", " ")) if t != "propos"]
                namensanteil = (
                    sum(1 for t in teile if t in anfrage) / len(teile) if teile else 0.0
                )
                hybrid = 0.6 * cos + 0.4 * bm25 + 0.2 * namensanteil
                scored.append((hybrid, name))
            scored.sort(reverse=True, key=lambda x: x[0])
            return [n for _, n in scored[:top_k]]

    def select_with_hot(self, query: str, allowed: frozenset[str], top_k: int = 5) -> list[str]:
        routed = self.select(query, allowed, top_k=top_k)
        hot = [n for n in HOTSET if n in allowed]
        seen = set(hot)
        result = list(hot)
        # Cluster-Erweiterung: Wenn ein Werkzeug gewählt wurde, schalte seine gesamte Gruppe frei
        group_peers: list[str] = []
        for n in routed:
            w = WERKZEUGE.get(n)
            if w and w.gruppe:
                for peer_name, peer_w in WERKZEUGE.items():
                    if peer_w.gruppe == w.gruppe and peer_name in allowed and peer_name not in seen:
                        group_peers.append(peer_name)
                        seen.add(peer_name)
        for n in routed:
            if n not in seen:
                result.append(n)
                seen.add(n)
        for n in group_peers:
            result.append(n)
        return result
