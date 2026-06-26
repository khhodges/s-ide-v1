"""
tests/builder/test_zip_contents.py

Assert that _make_fpga_zip() for the Ti60 F225 and Wukong XC7A100T includes
exactly the expected set of filenames.  Uses minimal stub artifact files — no
real Amaranth or Yosys toolchain required.

The Ti60 zip is built from:
  - All files in hardware/soc_combined/ (at their natural relative paths)
  - scripts/patch_sapphire_init.py          → scripts/patch_sapphire_init.py
  - bitstreams/church_ti60_f225.hex         → outflow/church_soc_cm.hex
  - bitstreams/church_ti60_f225.bit         → outflow/church_soc_cm.bit
  - BUILD.md string (always present)
  - docs/*.pdf files (if present, optional)

The Wukong zip is built from:
  - build/church_wukong_xc7a100t.v         → church_wukong_xc7a100t.v
  - build/church_wukong_xc7a100t.il        → church_wukong_xc7a100t.il  (optional)
  - hardware/wukong_xc7a100t.xdc           → wukong_xc7a100t.xdc
  - hardware/wukong_xc7a100t.tcl           → wukong_xc7a100t.tcl
  - server/local_bridge.py                 → local_bridge.py
  - BUILD.md string (always present)
"""

import os
import sys
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'server'))
from app import _make_fpga_zip, BUILD_MD_TI60, BUILD_MD_WUKONG


def _write_stub(path, content=b'stub'):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(content)


def _zip_namelist(buf):
    buf.seek(0)
    with zipfile.ZipFile(buf) as zf:
        return set(zf.namelist())


class TestTi60ZipContents:
    def _setup_stubs(self, tmp_path):
        hw_dir = tmp_path / 'hardware'
        soc_combined = hw_dir / 'soc_combined'
        scripts_dir = tmp_path / 'scripts'
        bitstreams_dir = tmp_path / 'bitstreams'

        # Minimal soc_combined structure (files appear at their relpath within soc_combined)
        for rel in ('church_soc_cm.xml', 'build_soc_cm.sh', 'Makefile',
                    'BUILD_SOC_CM.md', 'firmware/main.c'):
            _write_stub(str(soc_combined / rel))

        # patch_sapphire_init.py → scripts/patch_sapphire_init.py in ZIP
        _write_stub(str(scripts_dir / 'patch_sapphire_init.py'))

        # bitstreams → outflow/church_soc_cm.{hex,bit} in ZIP
        _write_stub(str(bitstreams_dir / 'church_ti60_f225.hex'))
        _write_stub(str(bitstreams_dir / 'church_ti60_f225.bit'))

        return {
            'rtlil':   str(hw_dir / 'build' / 'church_ti60_f225.il'),
            'verilog': str(hw_dir / 'build' / 'church_ti60_f225.v'),
            'isf':     str(hw_dir / 'ti60_f225.isf'),
            'project': str(hw_dir / 'ti60_f225_project.xml'),
            'peri':    str(hw_dir / 'ti60_f225.peri.xml'),
            'sdc':     str(hw_dir / 'ti60_f225.sdc'),
            'setup':   str(hw_dir / 'setup_ti60_peri.py'),
        }

    def test_build_md_always_present(self, tmp_path):
        """BUILD.md is always written regardless of optional files."""
        import unittest.mock as mock
        paths = self._setup_stubs(tmp_path)
        with mock.patch('app.BASE_DIR', str(tmp_path)):
            buf, zip_name, warnings = _make_fpga_zip(
                board='ti60-f225',
                is_ti60=True,
                paths=paths,
                zip_name='church-ti60-package.zip',
                build_md=BUILD_MD_TI60,
            )
        assert 'BUILD.md' in _zip_namelist(buf)
        assert zip_name == 'church-ti60-package.zip'
        assert warnings == []

    def test_soc_combined_files_included(self, tmp_path):
        """Files from soc_combined appear at their natural relative paths (no prefix)."""
        import unittest.mock as mock
        paths = self._setup_stubs(tmp_path)
        with mock.patch('app.BASE_DIR', str(tmp_path)):
            buf, _, _ = _make_fpga_zip(
                board='ti60-f225',
                is_ti60=True,
                paths=paths,
                zip_name='church-ti60-package.zip',
                build_md=BUILD_MD_TI60,
            )
        names = _zip_namelist(buf)
        # Files from soc_combined land at their relpath — no 'SoC/' prefix
        assert 'church_soc_cm.xml' in names
        assert 'build_soc_cm.sh' in names
        assert 'Makefile' in names
        assert 'BUILD_SOC_CM.md' in names
        assert 'firmware/main.c' in names
        # soc_combined root files must NOT have a prefix
        assert 'SoC/build_soc_cm.sh' not in names

    def test_patch_script_and_bitstreams(self, tmp_path):
        """patch_sapphire_init.py and bitstream files land at their expected paths."""
        import unittest.mock as mock
        paths = self._setup_stubs(tmp_path)
        with mock.patch('app.BASE_DIR', str(tmp_path)):
            buf, _, _ = _make_fpga_zip(
                board='ti60-f225',
                is_ti60=True,
                paths=paths,
                zip_name='church-ti60-package.zip',
                build_md=BUILD_MD_TI60,
            )
        names = _zip_namelist(buf)
        assert 'scripts/patch_sapphire_init.py' in names
        assert 'outflow/church_soc_cm.hex' in names
        assert 'outflow/church_soc_cm.bit' in names

    def test_skip_dirs_excluded(self, tmp_path):
        """outflow/, work_syn/, work_pnr/ inside soc_combined are not included."""
        import unittest.mock as mock
        paths = self._setup_stubs(tmp_path)
        # Add files in dirs that should be skipped
        soc_combined = tmp_path / 'hardware' / 'soc_combined'
        _write_stub(str(soc_combined / 'outflow' / 'old.bit'))
        _write_stub(str(soc_combined / 'work_syn' / 'junk.txt'))
        with mock.patch('app.BASE_DIR', str(tmp_path)):
            buf, _, _ = _make_fpga_zip(
                board='ti60-f225',
                is_ti60=True,
                paths=paths,
                zip_name='church-ti60-package.zip',
                build_md=BUILD_MD_TI60,
            )
        names = _zip_namelist(buf)
        assert 'outflow/old.bit' not in names
        assert 'work_syn/junk.txt' not in names

    def test_optional_files_absent_no_warnings(self, tmp_path):
        """Missing bitstreams and patch script do not produce errors."""
        import unittest.mock as mock
        # Only create soc_combined; omit patch script and bitstreams
        soc_combined = tmp_path / 'hardware' / 'soc_combined'
        _write_stub(str(soc_combined / 'build_soc_cm.sh'))
        paths = {
            'rtlil':   str(tmp_path / 'build' / 'church_ti60_f225.il'),
            'verilog': str(tmp_path / 'build' / 'church_ti60_f225.v'),
            'isf':     str(tmp_path / 'hardware' / 'ti60_f225.isf'),
            'project': str(tmp_path / 'hardware' / 'ti60_f225_project.xml'),
            'peri':    str(tmp_path / 'hardware' / 'ti60_f225.peri.xml'),
            'sdc':     str(tmp_path / 'hardware' / 'ti60_f225.sdc'),
            'setup':   str(tmp_path / 'hardware' / 'setup_ti60_peri.py'),
        }
        with mock.patch('app.BASE_DIR', str(tmp_path)):
            buf, zip_name, warnings = _make_fpga_zip(
                board='ti60-f225',
                is_ti60=True,
                paths=paths,
                zip_name='church-ti60-package.zip',
                build_md=BUILD_MD_TI60,
            )
        names = _zip_namelist(buf)
        assert 'BUILD.md' in names
        assert 'build_soc_cm.sh' in names
        assert warnings == []


class TestWukongZipContents:
    """Wukong XC7A100T ZIP — Vivado flow, no soc_combined directory."""

    def _setup_stubs(self, tmp_path):
        build_dir = tmp_path / 'build'
        hw_dir = tmp_path / 'hardware'
        server_dir = tmp_path / 'server'

        _write_stub(str(build_dir / 'church_wukong_xc7a100t.v'))
        _write_stub(str(build_dir / 'church_wukong_xc7a100t.il'))
        _write_stub(str(hw_dir / 'wukong_xc7a100t.xdc'))
        _write_stub(str(hw_dir / 'wukong_xc7a100t.tcl'))
        _write_stub(str(server_dir / 'local_bridge.py'))

        return {
            'verilog': str(build_dir / 'church_wukong_xc7a100t.v'),
            'rtlil':   str(build_dir / 'church_wukong_xc7a100t.il'),
            'xdc':     str(hw_dir / 'wukong_xc7a100t.xdc'),
            'tcl':     str(hw_dir / 'wukong_xc7a100t.tcl'),
        }

    def test_required_files_present(self, tmp_path):
        """Verilog, XDC, TCL, local_bridge.py, and BUILD.md are always in the ZIP."""
        import unittest.mock as mock
        paths = self._setup_stubs(tmp_path)
        with mock.patch('app.BASE_DIR', str(tmp_path)):
            buf, zip_name, warnings = _make_fpga_zip(
                board='wukong-xc7a100t',
                is_ti60=False,
                paths=paths,
                zip_name='church-wukong-package.zip',
                build_md=BUILD_MD_WUKONG,
            )
        names = _zip_namelist(buf)
        assert 'church_wukong_xc7a100t.v' in names
        assert 'wukong_xc7a100t.xdc' in names
        assert 'wukong_xc7a100t.tcl' in names
        assert 'local_bridge.py' in names
        assert 'BUILD.md' in names
        assert zip_name == 'church-wukong-package.zip'

    def test_rtlil_included_when_present(self, tmp_path):
        """RTLIL file is included in the ZIP when it exists on disk."""
        import unittest.mock as mock
        paths = self._setup_stubs(tmp_path)
        with mock.patch('app.BASE_DIR', str(tmp_path)):
            buf, _, _ = _make_fpga_zip(
                board='wukong-xc7a100t',
                is_ti60=False,
                paths=paths,
                zip_name='church-wukong-package.zip',
                build_md=BUILD_MD_WUKONG,
            )
        names = _zip_namelist(buf)
        assert 'church_wukong_xc7a100t.il' in names

    def test_missing_verilog_produces_warning(self, tmp_path):
        """Missing Verilog file emits a warning but still produces a ZIP."""
        import unittest.mock as mock
        hw_dir = tmp_path / 'hardware'
        server_dir = tmp_path / 'server'
        _write_stub(str(hw_dir / 'wukong_xc7a100t.xdc'))
        _write_stub(str(hw_dir / 'wukong_xc7a100t.tcl'))
        _write_stub(str(server_dir / 'local_bridge.py'))
        paths = {
            'verilog': str(tmp_path / 'build' / 'church_wukong_xc7a100t.v'),
            'rtlil':   str(tmp_path / 'build' / 'church_wukong_xc7a100t.il'),
            'xdc':     str(hw_dir / 'wukong_xc7a100t.xdc'),
            'tcl':     str(hw_dir / 'wukong_xc7a100t.tcl'),
        }
        with mock.patch('app.BASE_DIR', str(tmp_path)):
            buf, _, warnings = _make_fpga_zip(
                board='wukong-xc7a100t',
                is_ti60=False,
                paths=paths,
                zip_name='church-wukong-package.zip',
                build_md=BUILD_MD_WUKONG,
            )
        assert any('church_wukong_xc7a100t.v' in w for w in warnings)
        names = _zip_namelist(buf)
        assert 'BUILD.md' in names

    def test_exact_filename_set_no_extras(self, tmp_path):
        """ZIP contains exactly the expected files — no extra artifacts."""
        import unittest.mock as mock
        paths = self._setup_stubs(tmp_path)
        with mock.patch('app.BASE_DIR', str(tmp_path)):
            buf, _, _ = _make_fpga_zip(
                board='wukong-xc7a100t',
                is_ti60=False,
                paths=paths,
                zip_name='church-wukong-package.zip',
                build_md=BUILD_MD_WUKONG,
            )
        names = _zip_namelist(buf)
        expected = {
            'church_wukong_xc7a100t.v',
            'church_wukong_xc7a100t.il',
            'wukong_xc7a100t.xdc',
            'wukong_xc7a100t.tcl',
            'local_bridge.py',
            'BUILD.md',
        }
        assert names == expected
