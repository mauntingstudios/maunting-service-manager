"""Tests for Steam Workshop router error contracts."""
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from models import Server, User
from services.steam_service import SteamApiUnavailable


def test_workshop_search_returns_structured_missing_key_error(
    client: TestClient,
    owner_user: User,
    owner_cookies: dict,
    test_server: Server,
) -> None:
    with patch(
        "routers.steam.get_steam_service",
        new=AsyncMock(side_effect=SteamApiUnavailable("steam_api_key_missing")),
    ):
        response = client.get(
            f"/api/steam/workshop/search?server_id={test_server.id}&query=test",
            cookies=owner_cookies,
        )

    assert response.status_code == 503
    assert response.json()["detail"] == {
        "code": "steam_api_key_missing",
        "message": "errors.steam_api_key_missing",
    }


def test_workshop_popular_returns_structured_missing_key_error(
    client: TestClient,
    owner_user: User,
    owner_cookies: dict,
    test_server: Server,
) -> None:
    with patch(
        "routers.steam.get_steam_service",
        new=AsyncMock(side_effect=SteamApiUnavailable("steam_api_key_missing")),
    ):
        response = client.get(
            f"/api/steam/workshop/popular?server_id={test_server.id}",
            cookies=owner_cookies,
        )

    assert response.status_code == 503
    assert response.json()["detail"] == {
        "code": "steam_api_key_missing",
        "message": "errors.steam_api_key_missing",
    }


def test_workshop_details_returns_structured_unavailable_error(
    client: TestClient,
    owner_user: User,
    owner_cookies: dict,
    test_server: Server,
) -> None:
    with patch(
        "routers.steam.get_steam_service",
        new=AsyncMock(side_effect=SteamApiUnavailable("steam_api_unavailable")),
    ):
        response = client.get(
            f"/api/steam/workshop/mod/12345?server_id={test_server.id}",
            cookies=owner_cookies,
        )

    assert response.status_code == 503
    assert response.json()["detail"] == {
        "code": "steam_api_unavailable",
        "message": "errors.steam_api_unavailable",
    }


def test_workshop_filters_endpoint_and_community_html_parsing(
    client: TestClient,
    owner_user: User,
    owner_cookies: dict,
    test_server: Server,
) -> None:
    import asyncio
    from services.steam_service import SteamService

    service = SteamService()
    service.api_key = "test-key"

    sample_html = """
    <div class="rightSectionHolder">
      <label class="tag_label"><input class="inputTagsFilter" type="checkbox" name="requiredtags[]" value="Vehicles"> Vehicles (142)</label>
      <label class="tag_label"><input class="inputTagsFilter" type="checkbox" name="requiredtags[]" value="QoL &amp; UI"> QoL &amp; UI (89)</label>
    </div>
    """

    class _FakeResp:
        status_code = 200
        text = sample_html

    with patch.object(service.client, "get", new=AsyncMock(return_value=_FakeResp())):
        parsed = asyncio.run(service.get_workshop_filters("108600"))

    assert parsed["appid"] == "108600"
    assert parsed["source"] == "steam_community"
    assert parsed["tags"] == [
        {"id": "Vehicles", "name": "Vehicles"},
        {"id": "QoL & UI", "name": "QoL & UI"},
    ]

    mock_service = AsyncMock()
    mock_service.get_workshop_filters = AsyncMock(return_value=parsed)
    with patch("routers.steam.get_steam_service", new=AsyncMock(return_value=mock_service)):
        response = client.get(
            f"/api/steam/workshop/filters?server_id={test_server.id}",
            cookies=owner_cookies,
        )

    assert response.status_code == 200
    assert response.json()["tags"] == parsed["tags"]


def test_workshop_search_and_popular_forward_tags_and_sort(
    client: TestClient,
    owner_user: User,
    owner_cookies: dict,
    test_server: Server,
) -> None:
    mock_service = AsyncMock()
    mock_service.search_workshop_mods = AsyncMock(return_value=[])
    mock_service.get_popular_mods = AsyncMock(return_value=[])

    with patch("routers.steam.get_steam_service", new=AsyncMock(return_value=mock_service)):
        search_res = client.get(
            f"/api/steam/workshop/search?server_id={test_server.id}&query=map&tags=Vehicles,Maps&sort=popular",
            cookies=owner_cookies,
        )
        pop_res = client.get(
            f"/api/steam/workshop/popular?server_id={test_server.id}&sort=newest&tags=Vehicles",
            cookies=owner_cookies,
        )

    assert search_res.status_code == 200
    assert pop_res.status_code == 200
    search_kwargs = mock_service.search_workshop_mods.call_args.kwargs
    assert search_kwargs["sort"] == "popular"
    assert "Vehicles" in search_kwargs["required_tags"]
    assert "Maps" in search_kwargs["required_tags"]
    pop_kwargs = mock_service.get_popular_mods.call_args.kwargs
    assert pop_kwargs["sort"] == "newest"
    assert "Vehicles" in pop_kwargs["required_tags"]


def test_steam_service_does_not_cache_empty_popular_or_filters() -> None:
    import asyncio
    from unittest.mock import MagicMock
    from services.steam_service import SteamService

    service = SteamService()
    service.api_key = "test-key"

    empty_resp = MagicMock()
    empty_resp.raise_for_status = MagicMock()
    empty_resp.json.return_value = {"response": {"publishedfiledetails": []}}

    populated_resp = MagicMock()
    populated_resp.raise_for_status = MagicMock()
    populated_resp.json.return_value = {
        "response": {
            "publishedfiledetails": [
                {
                    "publishedfileid": "2169435993",
                    "result": 1,
                    "title": "Mod Options",
                    "short_description": "desc",
                    "creator": "author",
                    "file_size": 1024,
                    "time_created": 1700000000,
                    "time_updated": 1700000000,
                    "subscriptions": 100,
                    "favorited": 10,
                    "tags": [{"tag": "QoL"}],
                }
            ]
        }
    }

    with patch.object(
        service.client,
        "get",
        new=AsyncMock(side_effect=[empty_resp, populated_resp]),
    ):
        first = asyncio.run(service.get_popular_mods("108600", sort="trending", limit=24, page=1))
        second = asyncio.run(service.get_popular_mods("108600", sort="trending", limit=24, page=1))

    assert first == []
    assert len(second) == 1
    assert second[0].publishedfileid == "2169435993"
