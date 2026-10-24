"""Tests für die schlanke FIFO-Zustell-Queue."""

from __future__ import annotations

import pytest
from unittest.mock import MagicMock, patch
from sqlalchemy.orm import Session

from models import E2eeDeviceQueue, User, UserE2eeDevice
from services.social.queue_service import E2eeQueueService


def test_enqueue_and_fetch_pending():
    db = MagicMock(spec=Session)

    sender = User(id=1, username="alice")
    target_device = UserE2eeDevice(
        id=10, user_id=2, device_id="bob-phone", is_approved=True
    )

    # Mock query for friend / block check & target_device
    db.query.return_value.filter.return_value.first.side_effect = [
        None,  # block check passes
        target_device,  # target device found
    ]

    envelopes = [
        {
            "target_device_id": 10,
            "encrypted_payload": "enc:payload:123",
        }
    ]

    with patch("services.sync_event_service.SyncEventService.publish") as mock_publish:
        created_ids = E2eeQueueService.enqueue_message(
            db=db,
            sender=sender,
            envelopes=envelopes,
            client_uuid="uuid-1",
            chat_type="direct",
            chat_id="2",
        )

        assert db.add.called
        assert db.commit.called
        assert mock_publish.called

        # Prüfen, dass der Event-Typ 'new_message' ist
        call_args = mock_publish.call_args[0]
        event = call_args[0]
        assert event["type"] == "new_message"
        assert event["sender_id"] == 1
        assert event["sender_name"] == "alice"
        assert event["client_uuid"] == "uuid-1"


def test_acknowledge_emits_delivery_receipt():
    db = MagicMock(spec=Session)

    device = UserE2eeDevice(id=10, user_id=2, device_id="bob-phone", is_approved=True)
    item = E2eeDeviceQueue(
        id=99,
        target_device_id=10,
        sender_user_id=1,
        chat_type="direct",
        chat_id="2",
        client_uuid="uuid-1",
        encrypted_payload="enc:123",
    )

    db.query.return_value.filter.return_value.all.return_value = [item]

    with patch("services.sync_event_service.SyncEventService.publish") as mock_publish:
        deleted = E2eeQueueService.acknowledge_messages(db, device, [99])

        assert deleted == 1
        assert db.delete.called
        assert db.commit.called

        # Prüfen, dass delivery_receipt an den Absender ging
        assert mock_publish.called
        call_kwargs = mock_publish.call_args[1]
        call_args = mock_publish.call_args[0]
        event = call_args[0]
        assert event["type"] == "delivery_receipt"
        assert event["client_uuid"] == "uuid-1"
        assert call_kwargs["user_id"] == 1  # Absender Alice


def test_ack_receipt_is_after_commit_and_direct_only():
    db = MagicMock(spec=Session)
    device = UserE2eeDevice(id=10, user_id=2, device_id="test-phone", is_approved=True)
    items = [
        E2eeDeviceQueue(id=1, target_device_id=10, sender_user_id=1, chat_type="direct",
                       chat_id="2", client_uuid="logical#devA", encrypted_payload="test-cipher"),
        E2eeDeviceQueue(id=2, target_device_id=10, sender_user_id=1, chat_type="group",
                       chat_id="7", client_uuid="group-message", encrypted_payload="test-cipher"),
    ]
    db.query.return_value.filter.return_value.all.return_value = items
    order = []
    db.commit.side_effect = lambda: order.append("commit")
    with patch("services.sync_event_service.SyncEventService.publish") as publish:
        publish.side_effect = lambda *args, **kwargs: order.append("receipt")
        assert E2eeQueueService.acknowledge_messages(db, device, [1, 2]) == 2
        assert order == ["commit", "receipt"]
        event = publish.call_args.args[0]
        assert event["client_uuids"] == ["logical"]
        assert event["chat_type"] == "direct"
        assert event["chat_id"] == "2"


def test_failed_ack_commit_never_announces_delivery():
    db = MagicMock(spec=Session)
    device = UserE2eeDevice(id=10, user_id=2, device_id="test-phone", is_approved=True)
    db.query.return_value.filter.return_value.all.return_value = [
        E2eeDeviceQueue(id=1, target_device_id=10, sender_user_id=1, chat_type="direct",
                       chat_id="2", client_uuid="test-u", encrypted_payload="test-cipher"),
    ]
    db.commit.side_effect = RuntimeError("synthetic storage failure")
    with patch("services.sync_event_service.SyncEventService.publish") as publish:
        with pytest.raises(RuntimeError, match="synthetic"):
            E2eeQueueService.acknowledge_messages(db, device, [1])
        publish.assert_not_called()


def test_queue_preserves_each_envelope_uuid_in_postgres(db: Session):
    from routers.social.messages import SendMessageRequest

    sender = User(username="queue-sender", email="queue-sender@example.invalid", password_hash="synthetic")
    recipient = User(username="queue-recipient", email="queue-recipient@example.invalid", password_hash="synthetic")
    db.add_all([sender, recipient])
    db.commit()
    device = UserE2eeDevice(user_id=recipient.id, device_id="queue-test-phone",
                           public_key_jwk="synthetic-public-key", is_approved=True)
    db.add(device)
    db.commit()
    request = SendMessageRequest.model_validate({
        "client_uuid": "logical", "chat_type": "direct", "chat_id": str(recipient.id),
        "envelopes": [
            {"target_device_id": device.id, "encrypted_payload": "synthetic-control",
             "client_uuid": "ctrl:logical#iA"},
            {"target_device_id": device.id, "encrypted_payload": "synthetic-message",
             "client_uuid": "logical#devA"},
        ],
    })
    with patch("services.sync_event_service.SyncEventService.publish") as publish:
        ids = E2eeQueueService.enqueue_message(db, sender,
            [env.model_dump() for env in request.envelopes], request.client_uuid,
            request.chat_type, request.chat_id)
        assert len(ids) == 2
        pending = E2eeQueueService.fetch_pending_messages(db, device)
        assert [row["client_uuid"] for row in pending] == ["ctrl:logical#iA", "logical#devA"]
        assert [row["queue_id"] for row in pending] == ids
        publish.assert_called_once()
        assert publish.call_args.args[0]["type"] == "new_message"
        publish.reset_mock()
        assert E2eeQueueService.acknowledge_messages(db, device, ids) == 2
        assert E2eeQueueService.fetch_pending_messages(db, device) == []
        publish.assert_called_once()
        assert publish.call_args.args[0]["client_uuids"] == ["logical"]
        assert publish.call_args.kwargs["user_id"] == sender.id
        publish.reset_mock()
        E2eeQueueService.mark_chat_read(db, recipient, "direct", str(sender.id), ["logical#devA", "logical#devB"])
        publish.assert_called_once()
        assert publish.call_args.args[0]["type"] == "read_receipt"
        assert publish.call_args.args[0]["client_uuids"] == ["logical"]


def test_group_read_does_not_emit_receipts():
    with patch("services.sync_event_service.SyncEventService.publish") as publish:
        db = MagicMock(spec=Session)
        db.query.return_value.filter.return_value.all.return_value = [(1,), (2,)]
        E2eeQueueService.mark_chat_read(db, User(id=1, username="test-reader"), "group", "7", ["u"])
        publish.assert_not_called()
