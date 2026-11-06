"""Rollen-CRUD + Built-in-Seed.

`admin` und `user` sind System-Rollen (is_system=True): nicht loeschbar,
nicht umbenennbar. Die `admin`-Rolle wird beim Startup auf alle Permission-
Keys gesynct (Self-Heal, wenn neue Keys im Katalog erscheinen).
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from models import Role, RolePermission, User, UserRole
from services.permission_catalog import (
    ALL_KEYS,
    SYSTEM_ROLE_ADMIN,
    SYSTEM_ROLE_NAMES,
    SYSTEM_ROLE_USER,
    admin_role_keys,
    is_known_key,
)


def get_role_by_name(db: Session, name: str) -> Role | None:
    return db.query(Role).filter(Role.name == name).first()


def get_role(db: Session, role_id: int) -> Role | None:
    return db.query(Role).filter(Role.id == role_id).first()


def list_roles(db: Session) -> list[Role]:
    return db.query(Role).order_by(Role.id.asc()).all()


def role_permission_keys(db: Session, role_id: int) -> list[str]:
    rows = (
        db.query(RolePermission.permission_key)
        .filter(RolePermission.role_id == role_id)
        .all()
    )
    return sorted({r[0] for r in rows})


def effective_user_role_ids(db: Session, user: User) -> list[int]:
    """Liefert alle Rollen eines Users und berücksichtigt Legacy-Datensätze.

    ``users.role_id`` bleibt während der additiven Migration lesbar. Dadurch
    verlieren Accounts auch dann keine Rechte, wenn ein Rolling Update die
    Backfill-Migration noch nicht vollständig ausgeführt hat.
    """
    rows = db.query(UserRole.role_id).filter(UserRole.user_id == user.id).all()
    role_ids = {row[0] for row in rows}
    if user.role_id is not None:
        role_ids.add(user.role_id)
    return sorted(role_ids)


def effective_user_role_permission_keys(db: Session, user: User) -> list[str]:
    """Vereinigt die Permission-Keys aller globalen Rollen eines Users."""
    role_ids = effective_user_role_ids(db, user)
    if not role_ids:
        return []
    rows = (
        db.query(RolePermission.permission_key)
        .filter(RolePermission.role_id.in_(role_ids))
        .all()
    )
    return sorted({row[0] for row in rows})


def set_user_roles(
    db: Session,
    user: User,
    role_ids: list[int],
    *,
    commit: bool = True,
) -> list[int]:
    """Ersetzt alle Rollen eines Users atomar und hält ``role_id`` kompatibel.

    Die Funktion validiert vor der Mutation, damit eine unbekannte Rollen-ID
    keine partielle Zuweisung hinterlässt. Doppelte IDs werden normalisiert.
    """
    desired = sorted(set(role_ids))
    if desired:
        existing_role_ids = {
            row[0]
            for row in db.query(Role.id).filter(Role.id.in_(desired)).all()
        }
        missing = sorted(set(desired) - existing_role_ids)
        if missing:
            raise ValueError(f"Unbekannte Rollen-IDs: {missing}")

    existing = db.query(UserRole).filter(UserRole.user_id == user.id).all()
    existing_by_role = {assignment.role_id: assignment for assignment in existing}
    for role_id, assignment in existing_by_role.items():
        if role_id not in desired:
            db.delete(assignment)
    for role_id in desired:
        if role_id not in existing_by_role:
            db.add(UserRole(user_id=user.id, role_id=role_id))

    # Die kleinste ID ist nur ein stabiler Kompatibilitätswert. Autorisierung
    # wertet immer die vollständige Zuordnungstabelle aus.
    user.role_id = desired[0] if desired else None
    if commit:
        try:
            db.commit()
            db.refresh(user)
        except Exception:
            db.rollback()
            raise
    else:
        db.flush()
    return desired


def _replace_role_permissions(db: Session, role_id: int, keys: list[str], commit: bool = True) -> list[str]:
    desired = {k for k in keys if is_known_key(k)}
    existing = db.query(RolePermission).filter(RolePermission.role_id == role_id).all()
    existing_by_key = {p.permission_key: p for p in existing}
    for key, perm in existing_by_key.items():
        if key not in desired:
            db.delete(perm)
    for key in desired:
        if key not in existing_by_key:
            db.add(RolePermission(role_id=role_id, permission_key=key))
    db.commit() if commit else db.flush()
    return sorted(desired)


def create_role(
    db: Session,
    name: str,
    description: str | None,
    keys: list[str],
    color: str = "#3b82f6",
    icon: str | None = None,
    commit: bool = True,
) -> Role:
    """``commit=False`` flusht nur: der Aufrufer schreibt mit, was dazugehoert (KI-Karte, AGENTS 93)."""
    if name in SYSTEM_ROLE_NAMES:
        raise ValueError("Reservierter Rollenname")
    role = Role(
        name=name,
        description=description,
        color=color or "#3b82f6",
        icon=icon,
        is_system=False,
    )
    db.add(role)
    db.commit() if commit else db.flush()
    db.refresh(role)
    _replace_role_permissions(db, role.id, keys, commit)
    db.refresh(role)
    return role


def update_role(
    db: Session,
    role: Role,
    name: str | None,
    description: str | None,
    keys: list[str] | None,
    color: str | None = None,
    icon: str | None = None,
    commit: bool = True,
) -> Role:
    """is_system-Rollen: Name und is_system unveraenderlich. Permissions der
    admin-Rolle sind ebenfalls fest (alle Keys, Self-Heal). Permissions der
    user-Rolle koennen vom Owner editiert werden, falls gewuenscht.
    """
    if name is not None and not role.is_system:
        if name in SYSTEM_ROLE_NAMES:
            raise ValueError("Reservierter Rollenname")
        role.name = name
    if description is not None:
        role.description = description
    if color is not None:
        role.color = color
    if icon is not None:
        role.icon = icon if icon != "" else None
    db.commit() if commit else db.flush()

    if keys is not None and not (role.is_system and role.name == SYSTEM_ROLE_ADMIN):
        _replace_role_permissions(db, role.id, keys, commit)
    db.refresh(role)
    return role


def delete_role(db: Session, role: Role) -> None:
    if role.is_system:
        raise ValueError("System-Rolle kann nicht geloescht werden")
    legacy_in_use = db.query(User.id).filter(User.role_id == role.id).first()
    assigned_in_use = db.query(UserRole.id).filter(UserRole.role_id == role.id).first()
    if legacy_in_use is not None or assigned_in_use is not None:
        raise ValueError("Rolle ist noch Usern zugewiesen")
    db.delete(role)
    db.commit()


def ensure_system_roles(db: Session) -> tuple[Role, Role]:
    """Idempotent: legt `admin` und `user` an (falls nicht vorhanden) und
    synct die `admin`-Permissions auf den aktuellen Katalog.

    Wird beim Lifespan-Startup aufgerufen.
    """
    admin = get_role_by_name(db, SYSTEM_ROLE_ADMIN)
    if admin is None:
        admin = Role(
            name=SYSTEM_ROLE_ADMIN,
            description="Vollzugriff auf alle Funktionen",
            color="#ef4444",
            icon="crown",
            is_system=True,
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
    else:
        if not getattr(admin, "icon", None):
            admin.icon = "crown"
            admin.color = "#ef4444"
            db.commit()

    user = get_role_by_name(db, SYSTEM_ROLE_USER)
    if user is None:
        user = Role(
            name=SYSTEM_ROLE_USER,
            description="Standard-Rolle ohne globale Rechte; Server-Zugriffe via Delegation",
            color="#10b981",
            icon="user-check",
            is_system=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        if not getattr(user, "icon", None):
            user.icon = "user-check"
            user.color = "#10b981"
            db.commit()

    # admin-Rolle auf den aktuellen Katalog syncen
    _sync_role_permissions(db, admin.id, admin_role_keys())
    # Sanfte Migration: Rollen mit ai.calendar.use / ai.notes.use erhalten calendar.use / notes.use
    _migrate_calendar_notes_permissions(db)
    return admin, user


def _migrate_calendar_notes_permissions(db: Session) -> None:
    all_role_perms = db.query(RolePermission).all()
    roles_with_ai_cal = {p.role_id for p in all_role_perms if p.permission_key == "ai.calendar.use"}
    roles_with_ai_notes = {p.role_id for p in all_role_perms if p.permission_key == "ai.notes.use"}
    existing_cal = {p.role_id for p in all_role_perms if p.permission_key == "calendar.use"}
    existing_notes = {p.role_id for p in all_role_perms if p.permission_key == "notes.use"}
    changed = False
    for r_id in (roles_with_ai_cal - existing_cal):
        db.add(RolePermission(role_id=r_id, permission_key="calendar.use"))
        changed = True
    for r_id in (roles_with_ai_notes - existing_notes):
        db.add(RolePermission(role_id=r_id, permission_key="notes.use"))
        changed = True
    if changed:
        db.commit()


def _sync_role_permissions(db: Session, role_id: int, target_keys: frozenset[str]) -> None:
    existing = db.query(RolePermission).filter(RolePermission.role_id == role_id).all()
    existing_keys = {p.permission_key for p in existing}
    to_add = target_keys - existing_keys
    to_remove = existing_keys - target_keys
    for perm in existing:
        if perm.permission_key in to_remove:
            db.delete(perm)
    for key in to_add:
        db.add(RolePermission(role_id=role_id, permission_key=key))
    if to_add or to_remove:
        db.commit()


__all__ = [
    "create_role",
    "delete_role",
    "effective_user_role_ids",
    "effective_user_role_permission_keys",
    "ensure_system_roles",
    "get_role",
    "get_role_by_name",
    "list_roles",
    "role_permission_keys",
    "set_user_roles",
    "update_role",
]
