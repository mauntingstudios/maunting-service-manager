"""Gemeinsamer Konfigurationfehler fuer KI-Provider ohne Paket-Zyklus."""


class AiProviderConfigurationError(ValueError):
    """Die Provider-Konfiguration ist nicht schluessig."""
