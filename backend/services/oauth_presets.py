"""OAuth/OIDC-Provider-Presets (reine Konfigurations-Konstanten).

Endpunkte, Scopes und Claim-Mappings fuer die festen Presets. Custom-Presets
nutzen die Overrides aus dem Provider-Datensatz.

Sicherheit: Hier stehen KEINE Secrets. Nur oeffentliche, dokumentierte Endpoints.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class OAuthPreset:
    key: str
    label: str
    # Endpoints: None = "muss via Override gesetzt werden" (nur custom_*)
    authorization_endpoint: str | None
    token_endpoint: str | None
    userinfo_endpoint: str | None
    issuer: str | None  # nur fuer OIDC relevant
    default_scope: str
    # Mapping IdP-Claim -> MSM-Feld. Werte:
    #   "id"        — eindeutige User-ID (Pflicht)
    #   "email"     — E-Mail-Adresse
    #   "email_verified" — bool, ob die E-Mail vom IdP bestaetigt ist
    #   "username"  — bevorzugter Username
    #   "name"      — Vollname (Anzeige)
    #   "avatar"    — Avatar-URL
    claim_map: dict[str, str]
    # PKCE ist bei allen Presets aktiv (Sicherheits-Default)
    pkce: bool = True
    # Unterstuetzt der Provider OIDC (ID-Token) oder nur OAuth2 (userinfo)
    is_oidc: bool = True
    # Manche APIs verlangen die Client-ID als eigenen Kopf (Twitch: Client-Id).
    # Die Client-ID ist oeffentlich; das Secret bleibt am Token-Endpunkt.
    client_id_header: str | None = None


PRESETS: dict[str, OAuthPreset] = {
    "google": OAuthPreset(
        key="google",
        label="Google",
        authorization_endpoint="https://accounts.google.com/o/oauth2/v2/auth",
        token_endpoint="https://oauth2.googleapis.com/token",
        userinfo_endpoint="https://openidconnect.googleapis.com/v1/userinfo",
        issuer="https://accounts.google.com",
        default_scope="openid email profile",
        claim_map={
            "id": "sub",
            "email": "email",
            "email_verified": "email_verified",
            # Kein "username": Google hat keinen. Bis 09/2026 stand hier
            # "email", und aus name@gmail.com wurde der Name namegmailcom.
            "name": "name",
            "avatar": "picture",
        },
    ),
    "discord": OAuthPreset(
        key="discord",
        label="Discord",
        authorization_endpoint="https://discord.com/api/oauth2/authorize",
        token_endpoint="https://discord.com/api/oauth2/token",
        userinfo_endpoint="https://discord.com/api/users/@me",
        issuer=None,  # Discord ist OAuth2-only, kein OIDC
        default_scope="identify email",
        claim_map={
            "id": "id",
            "email": "email",
            "email_verified": "verified",  # Discord liefert nur "verified": bool
            "username": "username",
            "name": "global_name",
            "avatar": "avatar",
        },
        is_oidc=False,
    ),
    "github": OAuthPreset(
        key="github",
        label="GitHub",
        authorization_endpoint="https://github.com/login/oauth/authorize",
        token_endpoint="https://github.com/login/oauth/access_token",
        userinfo_endpoint="https://api.github.com/user",
        issuer=None,
        default_scope="read:user user:email",
        claim_map={
            "id": "id",
            "email": "email",  # kann null sein, dann ueber /user/emails fallback
            "email_verified": "_msm_default_true",  # GitHub verifiziert selbst
            "username": "login",
            "name": "name",
            "avatar": "avatar_url",
        },
        is_oidc=False,
    ),
    "microsoft": OAuthPreset(
        key="microsoft",
        label="Microsoft",
        authorization_endpoint="https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        token_endpoint="https://login.microsoftonline.com/common/oauth2/v2.0/token",
        userinfo_endpoint="https://graph.microsoft.com/oidc/userinfo",
        issuer="https://login.microsoftonline.com/common/v2.0",
        default_scope="openid email profile",
        claim_map={
            "id": "sub",
            "email": "email",
            "email_verified": "email_verified",
            "username": "preferred_username",
            "name": "name",
        },
    ),
    "twitter": OAuthPreset(
        key="twitter",
        label="X (Twitter)",
        authorization_endpoint="https://twitter.com/i/oauth2/authorize",
        token_endpoint="https://api.twitter.com/2/oauth2/token",
        userinfo_endpoint="https://api.twitter.com/2/users/me",
        issuer=None,
        default_scope="tweet.read users.read",
        claim_map={
            "id": "data.id",
            "email": "data.email",  # nur vorhanden, wenn User die Permission erteilt
            "email_verified": "_msm_default_true",
            "username": "data.username",
            "name": "data.name",
            "avatar": "data.profile_image_url",
        },
        is_oidc=False,
    ),
    "gitlab": OAuthPreset(
        key="gitlab",
        label="GitLab",
        authorization_endpoint="https://gitlab.com/oauth/authorize",
        token_endpoint="https://gitlab.com/oauth/token",
        userinfo_endpoint="https://gitlab.com/oauth/userinfo",
        issuer="https://gitlab.com",
        default_scope="openid profile email",
        claim_map={
            "id": "sub",
            "email": "email",
            "email_verified": "email_verified",
            "username": "preferred_username",
            "name": "name",
            "avatar": "picture",
        },
    ),
    "twitch": OAuthPreset(
        key="twitch",
        label="Twitch",
        authorization_endpoint="https://id.twitch.tv/oauth2/authorize",
        token_endpoint="https://id.twitch.tv/oauth2/token",
        # Helix antwortet mit {"data": [ {...} ]} und verlangt die Client-ID
        # als eigenen Kopf; beides deckt das Mapping/der Kopf unten ab.
        userinfo_endpoint="https://api.twitch.tv/helix/users",
        issuer=None,
        default_scope="user:read:email",
        claim_map={
            "id": "data.0.id",
            "email": "data.0.email",
            "email_verified": "_msm_default_true",
            "username": "data.0.login",
            "name": "data.0.display_name",
            "avatar": "data.0.profile_image_url",
        },
        is_oidc=False,
        client_id_header="Client-Id",
    ),
    "openai": OAuthPreset(
        key="openai",
        label="ChatGPT (OpenAI)",
        authorization_endpoint="https://auth.openai.com/api/accounts/authorize",
        token_endpoint="https://auth.openai.com/api/accounts/oauth/token",
        userinfo_endpoint="https://auth.openai.com/api/accounts/oauth/userinfo",
        issuer="https://auth.openai.com",
        default_scope="openid profile email",
        claim_map={
            "id": "sub",
            "email": "email",
            "email_verified": "email_verified",
            "name": "name",
            "avatar": "picture",
        },
    ),
    "huggingface": OAuthPreset(
        key="huggingface",
        label="Hugging Face",
        authorization_endpoint="https://huggingface.co/oauth/authorize",
        token_endpoint="https://huggingface.co/oauth/token",
        userinfo_endpoint="https://huggingface.co/oauth/userinfo",
        issuer="https://huggingface.co",
        default_scope="openid profile email",
        claim_map={
            "id": "sub",
            "email": "email",
            "email_verified": "email_verified",
            "username": "preferred_username",
            "name": "name",
            "avatar": "picture",
        },
    ),
    "slack": OAuthPreset(
        key="slack",
        label="Slack",
        authorization_endpoint="https://slack.com/openid/connect/authorize",
        token_endpoint="https://slack.com/api/openid.connect.token",
        userinfo_endpoint="https://slack.com/api/openid.connect.userInfo",
        issuer="https://slack.com",
        default_scope="openid profile email",
        claim_map={
            "id": "sub",
            "email": "email",
            "email_verified": "email_verified",
            "name": "name",
            "avatar": "picture",
        },
    ),
    "linkedin": OAuthPreset(
        key="linkedin",
        label="LinkedIn",
        authorization_endpoint="https://www.linkedin.com/oauth/v2/authorization",
        token_endpoint="https://www.linkedin.com/oauth/v2/accessToken",
        userinfo_endpoint="https://api.linkedin.com/v2/userinfo",
        issuer="https://www.linkedin.com/oauth",
        default_scope="openid profile email",
        claim_map={
            "id": "sub",
            "email": "email",
            "email_verified": "email_verified",
            "name": "name",
            "avatar": "picture",
        },
    ),
    "spotify": OAuthPreset(
        key="spotify",
        label="Spotify",
        authorization_endpoint="https://accounts.spotify.com/authorize",
        token_endpoint="https://accounts.spotify.com/api/token",
        userinfo_endpoint="https://api.spotify.com/v1/me",
        issuer=None,
        default_scope="user-read-email user-read-private",
        claim_map={
            "id": "id",
            "email": "email",
            "email_verified": "_msm_default_true",
            "name": "display_name",
            "avatar": "images.0.url",
        },
        is_oidc=False,
    ),
    "bitbucket": OAuthPreset(
        key="bitbucket",
        label="Bitbucket",
        authorization_endpoint="https://bitbucket.org/site/oauth2/authorize",
        token_endpoint="https://bitbucket.org/site/oauth2/access_token",
        userinfo_endpoint="https://api.bitbucket.org/2.0/user",
        issuer=None,
        default_scope="account email",
        claim_map={
            "id": "uuid",
            "username": "username",
            "name": "display_name",
            "avatar": "links.avatar.href",
        },
        is_oidc=False,
    ),
    "patreon": OAuthPreset(
        key="patreon",
        label="Patreon",
        authorization_endpoint="https://www.patreon.com/oauth2/authorize",
        token_endpoint="https://www.patreon.com/api/oauth2/token",
        userinfo_endpoint="https://www.patreon.com/api/oauth2/v2/identity?fields%5Buser%5D=email,full_name,image_url,is_email_verified,vanity",
        issuer=None,
        default_scope="identity identity[email]",
        claim_map={
            "id": "data.id",
            "email": "data.attributes.email",
            "email_verified": "data.attributes.is_email_verified",
            "username": "data.attributes.vanity",
            "name": "data.attributes.full_name",
            "avatar": "data.attributes.image_url",
        },
        is_oidc=False,
    ),
    "reddit": OAuthPreset(
        key="reddit",
        label="Reddit",
        authorization_endpoint="https://www.reddit.com/api/v1/authorize",
        token_endpoint="https://www.reddit.com/api/v1/access_token",
        userinfo_endpoint="https://oauth.reddit.com/api/v1/me",
        issuer=None,
        default_scope="identity",
        claim_map={
            "id": "id",
            "username": "name",
            "name": "name",
            "avatar": "icon_img",
        },
        is_oidc=False,
    ),
    "facebook": OAuthPreset(
        key="facebook",
        label="Facebook (Meta)",
        authorization_endpoint="https://www.facebook.com/v21.0/dialog/oauth",
        token_endpoint="https://graph.facebook.com/v21.0/oauth/access_token",
        userinfo_endpoint="https://graph.facebook.com/me?fields=id,name,email,picture.type(large)",
        issuer=None,
        default_scope="email public_profile",
        claim_map={
            "id": "id",
            "email": "email",
            "email_verified": "_msm_default_true",
            "name": "name",
            "avatar": "picture.data.url",
        },
        is_oidc=False,
    ),
    "zoom": OAuthPreset(
        key="zoom",
        label="Zoom",
        authorization_endpoint="https://zoom.us/oauth/authorize",
        token_endpoint="https://zoom.us/oauth/token",
        userinfo_endpoint="https://api.zoom.us/v2/users/me",
        issuer=None,
        default_scope="user:read:user",
        claim_map={
            "id": "id",
            "email": "email",
            "email_verified": "verified",
            "name": "display_name",
            "avatar": "pic_url",
        },
        is_oidc=False,
    ),
    "atlassian": OAuthPreset(
        key="atlassian",
        label="Atlassian",
        authorization_endpoint="https://auth.atlassian.com/authorize",
        token_endpoint="https://auth.atlassian.com/oauth/token",
        userinfo_endpoint="https://api.atlassian.com/me",
        issuer=None,
        default_scope="read:me",
        claim_map={
            "id": "account_id",
            "email": "email",
            "email_verified": "email_verified",
            "name": "name",
            "avatar": "picture",
        },
        is_oidc=False,
    ),
    "figma": OAuthPreset(
        key="figma",
        label="Figma",
        authorization_endpoint="https://www.figma.com/oauth",
        token_endpoint="https://api.figma.com/v1/oauth/token",
        userinfo_endpoint="https://api.figma.com/v1/me",
        issuer=None,
        default_scope="current_user:read",
        claim_map={
            "id": "id",
            "email": "email",
            "username": "handle",
            "name": "handle",
            "avatar": "img_url",
        },
        is_oidc=False,
    ),
    "yahoo": OAuthPreset(
        key="yahoo",
        label="Yahoo",
        authorization_endpoint="https://api.login.yahoo.com/oauth2/request_auth",
        token_endpoint="https://api.login.yahoo.com/oauth2/get_token",
        userinfo_endpoint="https://api.login.yahoo.com/openid/v1/userinfo",
        issuer="https://api.login.yahoo.com",
        default_scope="openid profile email",
        claim_map={
            "id": "sub",
            "email": "email",
            "email_verified": "email_verified",
            "name": "name",
            "avatar": "picture",
        },
    ),
    "paypal": OAuthPreset(
        key="paypal",
        label="PayPal",
        authorization_endpoint="https://www.paypal.com/signin/authorize",
        token_endpoint="https://api-m.paypal.com/v1/oauth2/token",
        userinfo_endpoint="https://api-m.paypal.com/v1/identity/openidconnect/userinfo?schema=openid",
        issuer="https://www.paypal.com",
        default_scope="openid profile email",
        claim_map={
            "id": "user_id",
            "email": "email",
            "email_verified": "email_verified",
            "name": "name",
        },
    ),
    "vercel": OAuthPreset(
        key="vercel",
        label="Vercel",
        authorization_endpoint="https://vercel.com/oauth/authorize",
        token_endpoint="https://api.vercel.com/login/oauth/token",
        userinfo_endpoint="https://api.vercel.com/login/oauth/userinfo",
        issuer="https://vercel.com",
        default_scope="openid email profile",
        claim_map={
            "id": "sub",
            "email": "email",
            "email_verified": "email_verified",
            "username": "preferred_username",
            "name": "name",
            "avatar": "picture",
        },
    ),
    "custom_oidc": OAuthPreset(
        key="custom_oidc",
        label="Custom OIDC (Keycloak, Authentik, Zitadel, ...)",
        authorization_endpoint=None,
        token_endpoint=None,
        userinfo_endpoint=None,
        issuer=None,
        default_scope="openid email profile",
        claim_map={
            "id": "sub",
            "email": "email",
            "email_verified": "email_verified",
            "username": "preferred_username",
            "name": "name",
        },
        # Endpoints werden per OIDC-Discovery vom issuer aufgeloest
        # (siehe oauth_service._fetch_oidc_discovery).
    ),
    "custom_oauth2": OAuthPreset(
        key="custom_oauth2",
        label="Custom OAuth2",
        authorization_endpoint=None,
        token_endpoint=None,
        userinfo_endpoint=None,
        issuer=None,
        default_scope="",
        claim_map={
            "id": "sub",  # Fallback; meistens nicht passend — Admin muss Mapping pflegen
            "email": "email",
            "username": "username",
            "name": "name",
        },
        is_oidc=False,
    ),
}


def get_preset(key: str) -> OAuthPreset | None:
    return PRESETS.get(key)


def known_preset(key: str) -> bool:
    return key in PRESETS


def list_presets() -> list[OAuthPreset]:
    return list(PRESETS.values())
