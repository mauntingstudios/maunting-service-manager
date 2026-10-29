"""Mailbox-Abos des Ereignis-Dienstes.

Der fruehere E2EE-Umschlagweg (blinde Mailbox, Besitznachweis, Tippsignal per
HTTP) ist mit dem Einheits-Transport entfallen. Was bleibt, ist die
Mechanik des Abos selbst: der Client sagt, welche Mailboxen ihn interessieren,
und der Server stellt nur dorthin zu. Dass die Kennung unratbar ist, traegt
die Schranke — dieselbe Logik wie beim Tresor.

Was hier festgehalten wird:

* **Abonnieren ist kein Selbstbedienungsladen.** Wer eine fremde Mailbox
  abonnieren koennte, saehe, wann es sich dort regt. Das ist Verkehrsanalyse,
  auch ohne ein einziges Byte Klartext.
* **Eine fremde Verbindung gehoert einem anderen.** Die `conn_id` steht im
  `ready`-Signal und reist durch den Browser; sie allein darf kein Abo setzen.
* **Ein Abo mit Angabe ist nie systemweit.** Ohne diese Bedingung ginge jedes
  Mailbox-Signal an jeden verbundenen Client.
"""

from __future__ import annotations

import pytest

from models import User
from services.sync_event_service import MAX_MAILBOXES, SyncEventService


# ── Hilfen ──────────────────────────────────────────────────────────────────


GEHEIM = "b" * 64


def _abonniere(user_id: int, mailboxen: list[str]) -> str:
    """Haengt einen Abonnenten ein und setzt seine Mailboxen direkt."""
    conn_id, _ = SyncEventService.subscribe(user_id=user_id)
    SyncEventService.set_mailboxes(conn_id, mailboxen, user_id=user_id)
    return conn_id


def _empfangen(conn_id: str) -> list[dict]:
    """Leert die Warteschlange eines Abonnenten."""
    sub = SyncEventService._subscribers.get(conn_id)
    if sub is None:
        return []
    raus = []
    while not sub.queue.empty():
        raus.append(sub.queue.get_nowait())
    return raus


@pytest.fixture(autouse=True)
def _leere_abonnenten():
    SyncEventService.clear_all_for_testing()
    yield
    SyncEventService.clear_all_for_testing()


# ── Das Abo selbst ──────────────────────────────────────────────────────────


def test_wer_abonniert_hat_bekommt_das_signal(owner_user: User) -> None:
    conn = _abonniere(owner_user.id, [GEHEIM])

    erreicht = SyncEventService.publish({"type": "probe"}, mailbox_id=GEHEIM)

    assert erreicht == 1
    assert len(_empfangen(conn)) == 1


def test_wer_nicht_abonniert_hat_bekommt_nichts(owner_user: User) -> None:
    # Der eigentliche Punkt: ein verbundener Client ohne dieses Abo darf nicht
    # erfahren, dass sich in der Mailbox etwas regt.
    conn = _abonniere(owner_user.id, ["a" * 64])

    SyncEventService.publish({"type": "probe"}, mailbox_id=GEHEIM)

    assert _empfangen(conn) == []


def test_ein_abo_mit_angabe_ist_nie_systemweit(owner_user: User) -> None:
    """`publish(mailbox_id=...)` darf nicht in den Systemzweig fallen.

    Der Systemzweig greift, wenn *keine* Angabe gemacht wurde. Stuende
    `mailbox_id` nicht in dieser Bedingung, ginge jedes Mailbox-Signal an
    jeden verbundenen Client — das Gegenteil des Gemeinten.
    """
    conn_id, _ = SyncEventService.subscribe(user_id=owner_user.id)  # ohne Abo

    SyncEventService.publish({"type": "probe"}, mailbox_id=GEHEIM)

    assert _empfangen(conn_id) == []


def test_die_liste_ersetzt_und_haengt_nicht_an(owner_user: User) -> None:
    # Eine verlassene Gruppe muss sich abbestellen lassen.
    conn = _abonniere(owner_user.id, [GEHEIM, "a" * 64])
    SyncEventService.set_mailboxes(conn, ["a" * 64], user_id=owner_user.id)

    SyncEventService.publish({"type": "probe"}, mailbox_id=GEHEIM)

    assert _empfangen(conn) == []


def test_eine_fremde_verbindung_laesst_sich_nicht_umhaengen(
    owner_user: User, regular_user: User
) -> None:
    """Die `conn_id` allein ist kein Ausweis.

    Sie steht im `ready`-Signal und reist durch den Browser. Ohne die
    Kontopruefung koennte ein fremdes Konto die Abos einer anderen Verbindung
    setzen — und sich so in deren Mailboxen einhaengen.
    """
    conn = _abonniere(owner_user.id, [GEHEIM])

    gesetzt = SyncEventService.set_mailboxes(conn, ["a" * 64], user_id=regular_user.id)

    assert gesetzt == 0
    # Und das alte Abo steht unveraendert.
    SyncEventService.publish({"type": "probe"}, mailbox_id=GEHEIM)
    assert len(_empfangen(conn)) == 1


def test_die_zahl_der_abos_ist_gedeckelt(owner_user: User) -> None:
    conn_id, _ = SyncEventService.subscribe(user_id=owner_user.id)

    gesetzt = SyncEventService.set_mailboxes(
        conn_id, [f"{i:064x}" for i in range(MAX_MAILBOXES + 50)], user_id=owner_user.id
    )

    assert gesetzt == MAX_MAILBOXES


def test_kontoweg_und_mailboxweg_stehen_nebeneinander(owner_user: User) -> None:
    """Der Bestand darf nicht kippen: `user_id` erreicht weiter jeden Client."""
    conn = _abonniere(owner_user.id, [GEHEIM])

    SyncEventService.publish({"type": "probe"}, user_id=owner_user.id)

    assert len(_empfangen(conn)) == 1
