"""M0 smoke tests for the server package."""

import lineage_server
import lineage_sim


def test_server_imports_sim() -> None:
    assert lineage_server.__version__
    assert lineage_sim.__version__
