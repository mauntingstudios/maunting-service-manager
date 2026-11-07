import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch
import pytest

# Ensure backend root is on sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from services.ai_project_service import (
    patch_project_file,
    AiProjectError,
    compute_file_diff,
)
from models.ai_project import AiProjectFile


def _dummy_file(content: str, path: str = "src/App.tsx") -> AiProjectFile:
    return AiProjectFile(
        id="test-file-id",
        project_id="test-proj-id",
        path=path,
        content=content,
        size_bytes=len(content.encode("utf-8")),
    )


def test_patch_project_file_single_edit():
    old_content = """import React from 'react';

export function App() {
  const [count, setCount] = React.useState(0);
  return (
    <div className="old-container">
      <h1>Counter: {count}</h1>
      <button onClick={() => setCount(c => c + 1)}>Increment</button>
    </div>
  );
}
"""

    mock_db = MagicMock()
    mock_user = MagicMock()
    cur_file = _dummy_file(old_content)

    with patch("services.ai_project_service.read_project_file", return_value=cur_file), \
         patch("services.ai_project_service.write_project_file") as mock_write:
        
        mock_write.side_effect = lambda db, user, pid, path, content, mime_type="text/plain": _dummy_file(content, path)

        updated_file, count = patch_project_file(
            mock_db,
            mock_user,
            "test-proj-id",
            "src/App.tsx",
            edits=[
                {
                    "find": '<div className="old-container">',
                    "replace": '<div className="new-styled-container p-4">',
                }
            ],
        )

        assert count == 1
        assert '<div className="new-styled-container p-4">' in updated_file.content
        assert '<div className="old-container">' not in updated_file.content
        mock_write.assert_called_once()


def test_patch_project_file_multiple_sequential_edits():
    old_content = "const port = 3000;\nconst host = 'localhost';\napp.listen(port);"

    mock_db = MagicMock()
    mock_user = MagicMock()
    cur_file = _dummy_file(old_content, "server.js")

    with patch("services.ai_project_service.read_project_file", return_value=cur_file), \
         patch("services.ai_project_service.write_project_file") as mock_write:
        
        mock_write.side_effect = lambda db, user, pid, path, content, mime_type="text/plain": _dummy_file(content, path)

        updated_file, count = patch_project_file(
            mock_db,
            mock_user,
            "test-proj-id",
            "server.js",
            edits=[
                {"find": "const port = 3000;", "replace": "const port = process.env.PORT || 8080;"},
                {"find": "const host = 'localhost';", "replace": "const host = '0.0.0.0';"},
            ],
        )

        assert count == 2
        assert "const port = process.env.PORT || 8080;" in updated_file.content
        assert "const host = '0.0.0.0';" in updated_file.content
        assert "const port = 3000;" not in updated_file.content


def test_patch_project_file_crlf_normalization():
    old_content = "function hello() {\r\n  return 'world';\r\n}\r\n"

    mock_db = MagicMock()
    mock_user = MagicMock()
    cur_file = _dummy_file(old_content, "hello.ts")

    with patch("services.ai_project_service.read_project_file", return_value=cur_file), \
         patch("services.ai_project_service.write_project_file") as mock_write:
        
        mock_write.side_effect = lambda db, user, pid, path, content, mime_type="text/plain": _dummy_file(content, path)

        # find has LF, file has CRLF
        updated_file, count = patch_project_file(
            mock_db,
            mock_user,
            "test-proj-id",
            "hello.ts",
            edits=[
                {"find": "  return 'world';", "replace": "  return 'msm';"},
            ],
        )

        assert count == 1
        assert "return 'msm';" in updated_file.content


def test_patch_project_file_find_not_found():
    old_content = "line 1\nline 2\nline 3"

    mock_db = MagicMock()
    mock_user = MagicMock()
    cur_file = _dummy_file(old_content, "file.txt")

    with patch("services.ai_project_service.read_project_file", return_value=cur_file):
        with pytest.raises(AiProjectError) as exc_info:
            patch_project_file(
                mock_db,
                mock_user,
                "test-proj-id",
                "file.txt",
                edits=[{"find": "does not exist", "replace": "something"}],
            )
        assert "wurde nicht gefunden" in str(exc_info.value)


def test_patch_project_file_ambiguous_find():
    old_content = "item = 1;\nitem = 1;\nitem = 1;"

    mock_db = MagicMock()
    mock_user = MagicMock()
    cur_file = _dummy_file(old_content, "file.txt")

    with patch("services.ai_project_service.read_project_file", return_value=cur_file):
        with pytest.raises(AiProjectError) as exc_info:
            patch_project_file(
                mock_db,
                mock_user,
                "test-proj-id",
                "file.txt",
                edits=[{"find": "item = 1;", "replace": "item = 2;"}],
            )
        assert "kommt 3-mal vor" in str(exc_info.value)
        assert "mehr Zeilen Kontext" in str(exc_info.value)


def test_compute_diff_for_patch():
    old_content = "first line\nsecond line\nthird line"
    new_content = "first line\nmodified second line\nthird line"

    diff = compute_file_diff(old_content, new_content, "test.txt")
    assert diff["is_new_file"] is False
    assert diff["added_lines"] == 1
    assert diff["removed_lines"] == 1
    assert "-second line" in diff["diff"]
    assert "+modified second line" in diff["diff"]


if __name__ == "__main__":
    test_patch_project_file_single_edit()
    test_patch_project_file_multiple_sequential_edits()
    test_patch_project_file_crlf_normalization()
    test_patch_project_file_find_not_found()
    test_patch_project_file_ambiguous_find()
    test_compute_diff_for_patch()
    print("All patch tests passed successfully!")
