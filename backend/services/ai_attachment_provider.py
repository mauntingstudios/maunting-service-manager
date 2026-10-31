"""Anhaenge in die Inhaltsform der Modellanbieter uebersetzen.

Ein Anhang ist nach dem Einlesen nur noch eines von zwei Dingen: Text oder
Bild. Diese Datei kennt beide Formen und die zwei Dialekte, in denen sie auf
die Leitung gehen:

* OpenAI und OpenAI-kompatible APIs (Chat Completions wie Responses) nehmen
  Text als ``{"type": "text"}`` und Bilder als ``image_url`` mit Data-URL.
* Anthropic nimmt Text genauso, Bilder aber als ``image``-Block mit
  ``source.type = "base64"``, getrenntem ``media_type`` und rohen Base64-Daten.

Die Uebersetzung steht **hier** und nicht in `ai_attachment_service`. Der
Service entscheidet, *welche* Anhaenge mitgehen und wieviel Text hineinpasst;
wie ein Block fuer den gewaehlten Anbieter aussieht, ist eine Frage des
Protokolls und gehoert zu den Adaptern.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

#: Die Herkunft eines Blocks im Prompt. Beide Werte sind bewusst
#: ``untrusted``: ein Anhang ist Benutzerdaten und keine Systemanweisung.
TEXT_HEADER = "Unvertrauenswuerdiger Anhang"
IMAGE_HEADER = "Unvertrauenswuerdiger Bildanhang"

#: Anthropic akzeptiert nur diese vier Bildtypen. Die Bildnormalisierung
#: erzeugt ausschliesslich PNG und JPEG; GIF/WebP bleiben nur fuer den
#: Pillow-losen Rueckfall stehen.
ANTHROPIC_IMAGE_TYPES = frozenset({
    "image/jpeg", "image/png", "image/gif", "image/webp",
})


@dataclass(frozen=True)
class PreparedAttachment:
    """Ein Anhang, der ohne Datenbank und ohne Redaction auskommt."""

    kind: Literal["text", "image"]
    filename: str
    text: str | None = None
    image_base64: str | None = None
    media_type: str | None = None


def text_block(item: PreparedAttachment) -> dict:
    return {
        "type": "text",
        "text": f"{TEXT_HEADER} {item.filename}:\n{item.text or ''}",
    }


def openai_image_blocks(item: PreparedAttachment) -> list[dict]:
    if not item.image_base64 or not item.media_type:
        return []
    return [
        {"type": "text", "text": f"{IMAGE_HEADER}: {item.filename}"},
        {
            "type": "image_url",
            "image_url": {
                "url": f"data:{item.media_type};base64,{item.image_base64}",
                "detail": "auto",
            },
        },
    ]


def anthropic_image_blocks(item: PreparedAttachment) -> list[dict]:
    """Ein Bild in Anthropics Blockform — oder eine Absage als Text.

    Ein Typ ausserhalb von ``ANTHROPIC_IMAGE_TYPES`` darf nicht als Bildblock
    hinausgehen: die API beantwortet ihn mit einem 400 und der ganze Lauf
    scheitert. Stattdessen sagt ein Textblock, dass das Bild nicht mitging.
    """
    if not item.image_base64 or not item.media_type:
        return []
    if item.media_type not in ANTHROPIC_IMAGE_TYPES:
        return [{
            "type": "text",
            "text": (
                f"{IMAGE_HEADER}: {item.filename}. Dieses Bildformat kann "
                "nicht als Bild uebertragen werden."
            ),
        }]
    return [
        {"type": "text", "text": f"{IMAGE_HEADER}: {item.filename}"},
        {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": item.media_type,
                "data": item.image_base64,
            },
        },
    ]


def anthropic_bildblock(media_type: str, daten: str) -> dict | None:
    """Ein einzelnes Bild im Anthropic-Format — fuer bestehende OpenAI-Bloecke.

    `anthropic_messages_adapter` uebersetzt auch Bilder, die nicht aus einem
    Anhang stammen (Bildschirmfotos der Desktop-Steuerung). Beide Wege bauen
    denselben Block; deshalb steht die Form hier und nicht zweimal.
    """
    if media_type not in ANTHROPIC_IMAGE_TYPES or not daten:
        return None
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": media_type, "data": daten},
    }


def blocks_for(
    item: PreparedAttachment, protokoll: str | None = None
) -> list[dict]:
    """Uebersetzt einen Anhang in die Blockform des Anbieterprotokolls.

    ``protokoll`` ist einer von drei Werten: ``"chat_completions"``,
    ``"responses"`` (beides OpenAI-kompatibel) oder ``"anthropic_messages"``.
    ``None`` bedeutet "unbekannt" und faellt auf OpenAI zurueck — das ist das
    verbreitete Format und funktioniert fuer alle OpenAI-kompatiblen APIs.
    """
    if item.kind == "text":
        return [text_block(item)]
    if protokoll == "anthropic_messages":
        return anthropic_image_blocks(item)
    # chat_completions, responses, None oder unbekannt → OpenAI-Format
    return openai_image_blocks(item)


def attachment_message(
    items: list[PreparedAttachment],
    *,
    protokoll: str | None = None,
    hinweis: str | None = None,
) -> dict | None:
    """Alle Anhaenge als **eine** Benutzernachricht.

    Eine Nachricht statt einer je Datei: die Anbieter behandeln aufeinander-
    folgende Benutzernachrichten unterschiedlich (Anthropic fasst sie
    zusammen, Chat Completions nicht), und fuer das Modell ist „der Benutzer
    hat diese Dateien mitgeschickt" ein Vorgang. Die Reihenfolge bleibt:
    Text, Bild, Text, Bild — so, wie der Benutzer sie ausgewaehlt hat.

    ``hinweis`` steht am Ende und nennt ausgelassene oder nicht auswertbare
    Anhaenge. Er ist ein Textblock und keine stille Luecke.
    """
    bloecke: list[dict] = []
    for item in items:
        bloecke.extend(blocks_for(item, protokoll))
    if hinweis:
        bloecke.append({"type": "text", "text": hinweis})
    if not bloecke:
        return None
    return {"role": "user", "content": bloecke}
