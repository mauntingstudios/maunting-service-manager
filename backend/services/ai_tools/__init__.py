"""Werkzeuge der KI.

Die Domaenenmodule importieren einander nicht ueber dieses Paket. Ein
Sammelimport hier zog beim Import jeder Domaene die Registry mit und schloss
den Kreis, den `ai_tool_spec` aufloest. Importe gehen direkt an ihr Modul
(`services.ai_tools.server_tools`, `...personal_tools` und so weiter).
"""
