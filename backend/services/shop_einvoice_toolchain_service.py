"""Kapselung der System-Toolchain fuer Factur-X / PDF/A-3b und XRechnung-Validierung.

Alle externen Werkzeuge (`gs`, `java`, KoSIT-Validator, veraPDF CLI) werden
ausschliesslich ueber dieses Modul aufgerufen. Ohne installierte und gepruefte
Toolchain wird ausdruecklich keine PDF/A-3-Konformitaet behauptet.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from glob import glob
from pathlib import Path
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape as xml_escape

from scripts.fetch_einvoice_toolchain import KOSIT_VALIDATOR_FILENAME

_SUBPROCESS_TIMEOUT_S = 45
_MAX_ERRORS = 20
_MAX_ERR_LEN = 300

_ICC_CANDIDATES = (
    "/usr/share/color/icc/ghostscript/srgb.icc",
    "/usr/share/ghostscript/*/iccprofiles/srgb.icc",
    "/usr/share/color/icc/colord/sRGB.icc",
    "/usr/share/color/icc/icc-profiles-free/sRGB.icc",
    "/usr/share/color/icc/sRGB.icc",
)


def tools_root() -> Path:
    """Basisverzeichnis der vorinstallierten Java-/CLI-Werkzeuge."""
    override = os.environ.get("MSM_EINVOICE_TOOLS_DIR", "").strip()
    if override:
        return Path(override)
    return Path(__file__).resolve().parent.parent / "tools" / "einvoice"


def find_ghostscript() -> str | None:
    """Sucht die Ghostscript-Binary im System-PATH."""
    return shutil.which("gs")


def find_java() -> str | None:
    """Sucht eine Java-Runtime im System-PATH."""
    return shutil.which("java")


def find_srgb_icc() -> Path | None:
    """Sucht ein installiertes sRGB-ICC-Profil fuer PDF/A-3b."""
    custom = tools_root() / "srgb.icc"
    if custom.is_file():
        return custom
    for pattern in _ICC_CANDIDATES:
        if "*" in pattern:
            matches = sorted(glob(pattern))
            for match in matches:
                candidate = Path(match)
                if candidate.is_file():
                    return candidate
        else:
            candidate = Path(pattern)
            if candidate.is_file():
                return candidate
    return None


def _kosit_paths() -> tuple[Path, Path, Path]:
    base = tools_root() / "kosit"
    jar = base / KOSIT_VALIDATOR_FILENAME
    config_dir = base / "config"
    scenarios = config_dir / "scenarios.xml"
    return jar, config_dir, scenarios


def _verapdf_bin() -> Path:
    return tools_root() / "verapdf" / "verapdf"


def toolchain_status() -> dict[str, bool]:
    """Liefert den Installations- und Bereitschaftsstatus der E-Rechnungs-Toolchain."""
    gs_ok = find_ghostscript() is not None
    java_ok = find_java() is not None
    kosit_jar, _cfg_dir, scenarios_xml = _kosit_paths()
    kosit_jar_ok = kosit_jar.is_file()
    kosit_cfg_ok = scenarios_xml.is_file()
    verapdf_ok = _verapdf_bin().is_file()
    icc_ok = find_srgb_icc() is not None

    pdfa3_ready = gs_ok and icc_ok and verapdf_ok and java_ok
    xrechnung_ready = java_ok and kosit_jar_ok and kosit_cfg_ok

    return {
        "ghostscript": gs_ok,
        "java": java_ok,
        "kosit_validator": kosit_jar_ok,
        "kosit_config": kosit_cfg_ok,
        "verapdf": verapdf_ok,
        "srgb_icc": icc_ok,
        "pdfa3_ready": pdfa3_ready,
        "xrechnung_validation_ready": xrechnung_ready,
        "facturx_certified_ready": pdfa3_ready and xrechnung_ready,
    }


def _truncate(text: str) -> str:
    cleaned = " ".join(text.split())
    if len(cleaned) <= _MAX_ERR_LEN:
        return cleaned
    return cleaned[: _MAX_ERR_LEN - 3] + "..."


def _dedup_errors(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        msg = _truncate(item)
        if not msg or msg in seen:
            continue
        seen.add(msg)
        result.append(msg)
        if len(result) >= _MAX_ERRORS:
            break
    return result


def _parse_kosit_reports(report_paths: list[Path]) -> tuple[bool, list[str]]:
    accepted = False
    rejected = False
    errors: list[str] = []

    for report_path in report_paths:
        try:
            root = ET.fromstring(report_path.read_text(encoding="utf-8", errors="replace"))
        except ET.ParseError:
            errors.append("KoSIT-Pruefbericht nicht lesbar")
            continue

        for elem in root.iter():
            local = elem.tag.split("}", 1)[-1]
            if local == "accept":
                accepted = True
            elif local == "reject":
                rejected = True
            elif local == "noScenarioMatched":
                rejected = True
                errors.append("Kein passendes XRechnung-Szenario gefunden")
            elif local == "message":
                level = (elem.attrib.get("level") or "").lower()
                text = "".join(elem.itertext()).strip()
                if text and level in ("error", "fatal", ""):
                    code = elem.attrib.get("code", "").strip()
                    prefix = f"[{code}] " if code else ""
                    errors.append(f"{prefix}{text}")

    return (accepted and not rejected), _dedup_errors(errors)


def validate_xrechnung_xml(xml_text: str) -> dict[str, object]:
    """Prueft XRechnung- oder Factur-X-XML mit dem offiziellen KoSIT-Validator."""
    java_bin = find_java()
    kosit_jar, config_dir, scenarios_xml = _kosit_paths()
    if not (java_bin and kosit_jar.is_file() and scenarios_xml.is_file()):
        return {
            "available": False,
            "valid": False,
            "errors": ["KoSIT-Validator nicht installiert"],
        }

    if not xml_text or not xml_text.strip():
        return {
            "available": True,
            "valid": False,
            "errors": ["Leeres XML-Dokument"],
        }

    with tempfile.TemporaryDirectory(prefix="msm-kosit-") as tmp_name:
        tmp_dir = Path(tmp_name)
        xml_path = tmp_dir / "invoice.xml"
        out_dir = tmp_dir / "reports"
        out_dir.mkdir(parents=True, exist_ok=True)
        xml_path.write_text(xml_text, encoding="utf-8")

        cmd = [
            java_bin,
            "-jar",
            str(kosit_jar),
            "-s",
            str(scenarios_xml),
            "-r",
            str(config_dir),
            "-o",
            str(out_dir),
            str(xml_path),
        ]
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=_SUBPROCESS_TIMEOUT_S,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return {
                "available": True,
                "valid": False,
                "errors": ["KoSIT-Validator Timeout"],
            }
        except OSError:
            return {
                "available": True,
                "valid": False,
                "errors": ["KoSIT-Validator nicht ausfuehrbar"],
            }

        reports = sorted(out_dir.glob("*.xml"))
        if not reports:
            fallback = _truncate(proc.stderr or proc.stdout or f"Exit-Code {proc.returncode}")
            return {
                "available": True,
                "valid": False,
                "errors": [fallback or "Kein KoSIT-Pruefbericht erzeugt"],
            }

        accepted, errors = _parse_kosit_reports(reports)
        valid = (proc.returncode == 0) and accepted
        if not valid and not errors:
            errors = [f"KoSIT-Pruefung abgelehnt (Exit-Code {proc.returncode})"]
        return {
            "available": True,
            "valid": valid,
            "errors": [] if valid else errors,
        }


def _parse_verapdf_mrr(xml_text: str) -> tuple[bool, list[str]]:
    if not xml_text.strip():
        return False, ["Leerer veraPDF-Pruefbericht"]
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return False, ["veraPDF-Pruefbericht nicht lesbar"]

    report_elem = None
    for elem in root.iter():
        if elem.tag.split("}", 1)[-1] == "validationReport":
            report_elem = elem
            break
    if report_elem is None:
        return False, ["Kein validationReport in veraPDF-Ausgabe"]

    compliant = (report_elem.attrib.get("isCompliant") or "").lower() == "true"
    errors: list[str] = []
    if not compliant:
        for elem in report_elem.iter():
            local = elem.tag.split("}", 1)[-1]
            if local == "rule" and (elem.attrib.get("status") or "").lower() == "failed":
                clause = elem.attrib.get("clause", "")
                test_no = elem.attrib.get("testNumber", "")
                ref = f"ISO {clause}-{test_no}".strip("-")
                desc = ""
                for child in elem:
                    if child.tag.split("}", 1)[-1] == "description":
                        desc = "".join(child.itertext()).strip()
                        break
                msg = f"{ref}: {desc}" if desc else f"Regel verletzt: {ref or 'unbekannt'}"
                errors.append(msg)
        if not errors:
            errors.append("PDF/A-3b-Validierung fehlgeschlagen")

    return compliant, _dedup_errors(errors)


def validate_pdfa3(pdf_bytes: bytes) -> dict[str, object]:
    """Prueft PDF-Bytes gegen PDF/A-3b mittels veraPDF CLI."""
    verapdf_bin = _verapdf_bin()
    java_bin = find_java()
    if not (verapdf_bin.is_file() and java_bin):
        return {
            "available": False,
            "valid": False,
            "flavour": "3b",
            "errors": ["veraPDF nicht installiert"],
        }

    if not pdf_bytes or not pdf_bytes.startswith(b"%PDF-"):
        return {
            "available": True,
            "valid": False,
            "flavour": "3b",
            "errors": ["Ungueltige PDF-Daten"],
        }

    with tempfile.TemporaryDirectory(prefix="msm-verapdf-") as tmp_name:
        pdf_path = Path(tmp_name) / "document.pdf"
        pdf_path.write_bytes(pdf_bytes)
        cmd = [str(verapdf_bin), "--flavour", "3b", "--format", "mrr", str(pdf_path)]
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=_SUBPROCESS_TIMEOUT_S,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return {
                "available": True,
                "valid": False,
                "flavour": "3b",
                "errors": ["veraPDF Timeout"],
            }
        except OSError:
            return {
                "available": True,
                "valid": False,
                "flavour": "3b",
                "errors": ["veraPDF nicht ausfuehrbar"],
            }

        compliant, errors = _parse_verapdf_mrr(proc.stdout or "")
        valid = (proc.returncode == 0) and compliant
        if not valid and not errors:
            detail = _truncate(proc.stderr or f"Exit-Code {proc.returncode}")
            errors = [detail or "veraPDF-Validierung fehlgeschlagen"]
        return {
            "available": True,
            "valid": valid,
            "flavour": "3b",
            "errors": [] if valid else errors,
        }


def _ps_string(text: str) -> str:
    ascii_safe = re.sub(r"[^\x20-\x7e]", "_", text)
    return ascii_safe.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _build_facturx_xmp(document_type: str = "INVOICE") -> str:
    safe_doc_type = xml_escape(document_type)
    return (
        '<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>\n'
        '<x:xmpmeta xmlns:x="adobe:ns:meta/">\n'
        ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n'
        '  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">\n'
        "   <pdfaid:part>3</pdfaid:part>\n"
        "   <pdfaid:conformance>B</pdfaid:conformance>\n"
        "  </rdf:Description>\n"
        '  <rdf:Description rdf:about="" '
        'xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" '
        'xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" '
        'xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">\n'
        "   <pdfaExtension:schemas>\n"
        "    <rdf:Bag>\n"
        '     <rdf:li rdf:parseType="Resource">\n'
        "      <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>\n"
        "      <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>\n"
        "      <pdfaSchema:prefix>fx</pdfaSchema:prefix>\n"
        "      <pdfaSchema:property>\n"
        "       <rdf:Seq>\n"
        '        <rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentFileName</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>name of the embedded XML invoice file</pdfaProperty:description></rdf:li>\n'
        '        <rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentType</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>INVOICE</pdfaProperty:description></rdf:li>\n'
        '        <rdf:li rdf:parseType="Resource"><pdfaProperty:name>Version</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The actual version of the Factur-X XML schema</pdfaProperty:description></rdf:li>\n'
        '        <rdf:li rdf:parseType="Resource"><pdfaProperty:name>ConformanceLevel</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The conformance level of the embedded Factur-X data</pdfaProperty:description></rdf:li>\n'
        "       </rdf:Seq>\n"
        "      </pdfaSchema:property>\n"
        "     </rdf:li>\n"
        "    </rdf:Bag>\n"
        "   </pdfaExtension:schemas>\n"
        "  </rdf:Description>\n"
        '  <rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">\n'
        "   <fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>\n"
        f"   <fx:DocumentType>{safe_doc_type}</fx:DocumentType>\n"
        "   <fx:Version>1.0</fx:Version>\n"
        "   <fx:ConformanceLevel>XRECHNUNG</fx:ConformanceLevel>\n"
        "  </rdf:Description>\n"
        " </rdf:RDF>\n"
        "</x:xmpmeta>\n"
        '<?xpacket end="w"?>\n'
    )


def _build_pdfa3_postscript(
    *,
    xml_path: Path,
    xmp_path: Path,
    icc_path: Path,
    title: str,
) -> str:
    pdf_date = datetime.now(timezone.utc).strftime("D:%Y%m%d%H%M%SZ")
    icc_str = _ps_string(str(icc_path))
    xml_str = _ps_string(str(xml_path))
    xmp_str = _ps_string(str(xmp_path))
    title_str = _ps_string(title)

    return "\n".join(
        [
            "%!PS",
            "[ /_objdef {icc_PDFA} /type /stream /OBJ pdfmark",
            "[ {icc_PDFA} << /N 3 >> /PUT pdfmark",
            f"[ {{icc_PDFA}} ({icc_str}) (r) file /PUT pdfmark",
            "[ /_objdef {OutputIntent_PDFA} /type /dict /OBJ pdfmark",
            "[ {OutputIntent_PDFA} <<",
            "  /Type /OutputIntent",
            "  /S /GTS_PDFA1",
            "  /OutputCondition (sRGB)",
            "  /OutputConditionIdentifier (sRGB)",
            "  /RegistryName (http://www.color.org)",
            "  /Info (sRGB IEC61966-2.1)",
            "  /DestOutputProfile {icc_PDFA}",
            ">> /PUT pdfmark",
            "",
            "[ /_objdef {fx_stream} /type /stream /OBJ pdfmark",
            "[ {fx_stream} <<",
            "  /Type /EmbeddedFile",
            "  /Subtype /text#2Fxml",
            f"  /Params << /ModDate ({pdf_date}) >>",
            ">> /PUT pdfmark",
            f"[ {{fx_stream}} ({xml_str}) (r) file /PUT pdfmark",
            "",
            "[ /_objdef {fx_filespec} /type /dict /OBJ pdfmark",
            "[ {fx_filespec} <<",
            "  /Type /Filespec",
            "  /F (factur-x.xml)",
            "  /UF (factur-x.xml)",
            "  /Desc (Factur-X XRechnung CII XML)",
            "  /EF << /F {fx_stream} /UF {fx_stream} >>",
            "  /AFRelationship /Alternative",
            ">> /PUT pdfmark",
            "",
            "[ /_objdef {fx_names} /type /dict /OBJ pdfmark",
            "[ {fx_names} << /Names [(factur-x.xml) {fx_filespec}] >> /PUT pdfmark",
            "[ /_objdef {names_dict} /type /dict /OBJ pdfmark",
            "[ {names_dict} << /EmbeddedFiles {fx_names} >> /PUT pdfmark",
            "",
            "[ /_objdef {xmp_stream} /type /stream /OBJ pdfmark",
            "[ {xmp_stream} << /Type /Metadata /Subtype /XML >> /PUT pdfmark",
            f"[ {{xmp_stream}} ({xmp_str}) (r) file /PUT pdfmark",
            "",
            "[ {Catalog} <<",
            "  /OutputIntents [{OutputIntent_PDFA}]",
            "  /AF [{fx_filespec}]",
            "  /Names {names_dict}",
            "  /Metadata {xmp_stream}",
            ">> /PUT pdfmark",
            "",
            f"[ /Title ({title_str}) /Author (MSM) /Creator (MSM Invoice) /DOCINFO pdfmark",
        ]
    )


def build_facturx_pdfa3(
    plain_pdf_bytes: bytes,
    facturx_xml: str,
    *,
    title: str,
    document_type: str = "INVOICE",
) -> tuple[bytes, bool]:
    """Bettet Factur-X CII-XML via Ghostscript als PDF/A-3b ein und zertifiziert per veraPDF.

    Liefert ``(pdf_bytes, True)`` **ausschliesslich**, wenn die fertige Datei
    durch veraPDF erfolgreich gegen PDF/A-3b geprueft wurde. Bei fehlender
    Toolchain oder fehlgeschlagener Pruefung wird ohne Ausnahmefall auf das
    unveraenderte Plain-PDF mit ``False`` zurueckgefallen.
    """
    gs_bin = find_ghostscript()
    icc_path = find_srgb_icc()
    verapdf_bin = _verapdf_bin()
    java_bin = find_java()
    if not (gs_bin and icc_path and verapdf_bin.is_file() and java_bin):
        return plain_pdf_bytes, False

    if not plain_pdf_bytes or not facturx_xml.strip():
        return plain_pdf_bytes, False

    with tempfile.TemporaryDirectory(prefix="msm-pdfa3-") as tmp_name:
        tmp_dir = Path(tmp_name)
        in_pdf = tmp_dir / "input.pdf"
        out_pdf = tmp_dir / "output.pdf"
        xml_path = tmp_dir / "factur-x.xml"
        xmp_path = tmp_dir / "factur-x.xmp"
        ps_path = tmp_dir / "PDFA_def.ps"

        in_pdf.write_bytes(plain_pdf_bytes)
        xml_path.write_text(facturx_xml, encoding="utf-8")
        xmp_path.write_text(_build_facturx_xmp(document_type), encoding="utf-8")
        ps_path.write_text(
            _build_pdfa3_postscript(
                xml_path=xml_path,
                xmp_path=xmp_path,
                icc_path=icc_path,
                title=title,
            ),
            encoding="utf-8",
        )

        cmd = [
            gs_bin,
            f"--permit-file-read={tmp_dir}/",
            f"--permit-file-read={icc_path}",
            "-dPDFA=3",
            "-dCompatibilityLevel=1.4",
            "-dBATCH",
            "-dNOPAUSE",
            "-dNOOUTERSAVE",
            "-sColorConversionStrategy=RGB",
            "-sProcessColorModel=DeviceRGB",
            "-dPDFACompatibilityPolicy=1",
            "-sDEVICE=pdfwrite",
            f"-sOutputFile={out_pdf}",
            str(ps_path),
            str(in_pdf),
        ]
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                timeout=_SUBPROCESS_TIMEOUT_S,
                check=False,
            )
        except (subprocess.TimeoutExpired, OSError):
            return plain_pdf_bytes, False

        if proc.returncode != 0 or not out_pdf.is_file():
            return plain_pdf_bytes, False

        candidate = out_pdf.read_bytes()
        verapdf_result = validate_pdfa3(candidate)
        if not verapdf_result.get("valid"):
            return plain_pdf_bytes, False
        return candidate, True
