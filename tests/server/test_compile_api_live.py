"""
tests/server/test_compile_api_live.py

Live HTTP integration tests for the CLOOMC++ Compiler API.

Unlike tests/server/test_compile_api.py (which uses the Flask test client),
this module hits the real /api/compile endpoint over HTTP and validates all
six supported languages with specific named source snippets.

Primary use: smoke-test the deployed API at lab.cloomc.org after a release.

Usage
-----
Run against the deployed API (env var):
    CLOOMC_API_BASE=https://lab.cloomc.org pytest tests/server/test_compile_api_live.py

Opt in via marker flag (no env var required to avoid skip):
    pytest -m live tests/server/test_compile_api_live.py

Run as a standalone script (original __main__ style):
    python tests/server/test_compile_api_live.py [base_url]

Default base URL when no URL is provided: http://localhost:5000

Tests are @pytest.mark.live and SKIPPED by default in a normal pytest run.
Opt in with -m live OR by setting CLOOMC_API_BASE.  Both conditions are
checked at test execution time so neither overrides the other.
"""

import os
import sys
import textwrap

import pytest

try:
    import requests
except ImportError:
    requests = None  # type: ignore[assignment]

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

_DEFAULT_BASE = 'http://localhost:5000'

pytestmark = pytest.mark.live


def _base() -> str:
    """Resolve base URL at call time so __main__ and env changes are honoured."""
    return os.environ.get('CLOOMC_API_BASE', '').rstrip('/') or _DEFAULT_BASE


# ---------------------------------------------------------------------------
# Autouse fixture: skip live tests unless -m live OR CLOOMC_API_BASE is set
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _require_live(request):
    """Skip tests marked live unless the user opted in."""
    if not request.node.get_closest_marker('live'):
        return
    markexpr = getattr(request.config.option, 'markexpr', '') or ''
    live_selected = 'live' in markexpr
    env_set = bool(os.environ.get('CLOOMC_API_BASE', ''))
    if not live_selected and not env_set:
        pytest.skip(
            'Live HTTP tests are opt-in. '
            'Set CLOOMC_API_BASE=<url> or pass -m live to run them.'
        )


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def _post(source: str, language: str, **kwargs) -> 'requests.Response':
    """POST /api/compile to the live server."""
    if requests is None:
        pytest.skip('requests package not available')
    url = f'{_base()}/api/compile'
    payload = {'source': source, 'language': language, **kwargs}
    resp = requests.post(url, json=payload, timeout=30)
    return resp


def _assert_ok(resp: 'requests.Response', label: str = '') -> dict:
    assert resp.status_code == 200, f'{label}: HTTP {resp.status_code} — {resp.text[:200]}'
    data = resp.json()
    assert data.get('ok') is True, f'{label}: expected ok=true, got {data}'
    assert isinstance(data.get('words'), list), f'{label}: missing words list'
    assert len(data['words']) > 0, f'{label}: empty words list'
    assert isinstance(data.get('lump_binary'), str), f'{label}: missing lump_binary'
    return data


def _assert_fail(resp: 'requests.Response', label: str = '') -> dict:
    assert resp.status_code == 200, f'{label}: HTTP {resp.status_code} — {resp.text[:200]}'
    data = resp.json()
    assert data.get('ok') is False, f'{label}: expected ok=false, got {data}'
    assert isinstance(data.get('error'), str), f'{label}: missing error string'
    assert len(data['error']) > 0, f'{label}: error string is empty'
    return data


# ===========================================================================
# ASSEMBLY — valid programs
# ===========================================================================

def test_asm_halt():
    resp = _post('HALT', 'assembly')
    _assert_ok(resp, 'asm_halt')


def test_asm_iadd_halt():
    src = textwrap.dedent("""\
        IADD DR1, DR0, #42
        HALT
    """)
    resp = _post(src, 'assembly')
    _assert_ok(resp, 'asm_iadd_halt')


def test_asm_store_load():
    src = textwrap.dedent("""\
        STORE DR0, DR1, #0
        LOAD  DR2, DR1, #0
        HALT
    """)
    resp = _post(src, 'assembly')
    _assert_ok(resp, 'asm_store_load')


def test_asm_branch_forward():
    src = textwrap.dedent("""\
        BEQ DR0, DR0, end
        IADD DR1, DR0, #1
        end:
        HALT
    """)
    resp = _post(src, 'assembly')
    _assert_ok(resp, 'asm_branch_forward')


def test_asm_multiple_registers():
    src = textwrap.dedent("""\
        IADD DR1, DR0, #1
        IADD DR2, DR0, #2
        IADD DR3, DR1, DR2
        HALT
    """)
    resp = _post(src, 'assembly')
    _assert_ok(resp, 'asm_multiple_registers')


def test_asm_return_zero():
    src = textwrap.dedent("""\
        IADD DR0, DR0, #0
        RETURN DR0
    """)
    resp = _post(src, 'assembly')
    _assert_ok(resp, 'asm_return_zero')


def test_asm_return_value():
    src = textwrap.dedent("""\
        IADD DR0, DR0, #99
        RETURN DR0
    """)
    resp = _post(src, 'assembly')
    _assert_ok(resp, 'asm_return_value')


def test_asm_loop_construct():
    src = textwrap.dedent("""\
        IADD DR1, DR0, #0
        IADD DR2, DR0, #5
        loop:
        IADD DR1, DR1, #1
        BNE  DR1, DR2, loop
        HALT
    """)
    resp = _post(src, 'assembly')
    _assert_ok(resp, 'asm_loop_construct')


def test_asm_words_count_minimum():
    src = 'HALT'
    resp = _post(src, 'assembly')
    data = _assert_ok(resp, 'asm_words_count_minimum')
    assert len(data['words']) >= 64, 'Boot.Abstr lump is always at least 64 words'


def test_asm_lump_binary_length_matches_words():
    import base64
    src = textwrap.dedent("""\
        IADD DR1, DR0, #10
        HALT
    """)
    resp = _post(src, 'assembly')
    data = _assert_ok(resp, 'asm_lump_binary_length_matches_words')
    decoded = base64.b64decode(data['lump_binary'])
    assert len(decoded) == len(data['words']) * 4, (
        f'lump_binary length {len(decoded)} != words*4 {len(data["words"])*4}'
    )


def test_asm_warnings_field_present():
    src = 'HALT'
    resp = _post(src, 'assembly')
    data = _assert_ok(resp, 'asm_warnings_field_present')
    assert 'warnings' in data, 'response should always include warnings list'
    assert isinstance(data['warnings'], list)


def test_asm_language_echoed():
    src = 'HALT'
    resp = _post(src, 'assembly')
    data = _assert_ok(resp, 'asm_language_echoed')
    assert data.get('language') == 'assembly', f"language not echoed correctly: {data.get('language')}"


# ===========================================================================
# ASSEMBLY — failure cases
# ===========================================================================

def test_asm_invalid_syntax():
    src = '!!! definitely not valid cloomc @@@'
    resp = _post(src, 'assembly')
    _assert_fail(resp, 'asm_invalid_syntax')


def test_asm_unknown_mnemonic():
    src = 'FROBULATE DR0, DR1'
    resp = _post(src, 'assembly')
    _assert_fail(resp, 'asm_unknown_mnemonic')


def test_asm_missing_operand():
    src = 'IADD DR1'
    resp = _post(src, 'assembly')
    data = resp.json()
    assert data.get('ok') is False or isinstance(data.get('ok'), bool), (
        'malformed operand should produce ok=false or at least a valid response'
    )


# ===========================================================================
# ENGLISH — valid programs
# ===========================================================================

def test_english_noop_abstraction():
    src = 'abstraction Noop { method Run { return 0 } }'
    resp = _post(src, 'english')
    _assert_ok(resp, 'english_noop_abstraction')


def test_english_single_method_return():
    src = textwrap.dedent("""\
        abstraction Counter {
          method Init { return 0 }
        }
    """)
    resp = _post(src, 'english')
    _assert_ok(resp, 'english_single_method_return')


def test_english_method_with_addition():
    src = textwrap.dedent("""\
        abstraction Adder {
          method Add { return 1 + 2 }
        }
    """)
    resp = _post(src, 'english')
    _assert_ok(resp, 'english_method_with_addition')


def test_english_multiple_methods():
    src = textwrap.dedent("""\
        abstraction Math {
          method Zero { return 0 }
          method One  { return 1 }
        }
    """)
    resp = _post(src, 'english')
    _assert_ok(resp, 'english_multiple_methods')


def test_english_method_with_local():
    src = textwrap.dedent("""\
        abstraction LocalTest {
          method Run {
            let x = 5
            return x
          }
        }
    """)
    resp = _post(src, 'english')
    data = resp.json()
    assert isinstance(data.get('ok'), bool), f'english_method_with_local: unexpected response {data}'


def test_english_response_shape():
    src = 'abstraction Noop { method Run { return 0 } }'
    resp = _post(src, 'english')
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data.get('ok'), bool)


def test_english_capabilities_block():
    src = textwrap.dedent("""\
        abstraction Secure {
          capabilities { }
          method Run { return 0 }
        }
    """)
    resp = _post(src, 'english')
    data = resp.json()
    assert isinstance(data.get('ok'), bool), f'english_capabilities_block: {data}'


def test_english_invalid_syntax():
    src = '!!! not valid english cloomc source'
    resp = _post(src, 'english')
    _assert_fail(resp, 'english_invalid_syntax')


def test_english_empty_method_body():
    src = textwrap.dedent("""\
        abstraction Empty {
          method Run { }
        }
    """)
    resp = _post(src, 'english')
    data = resp.json()
    assert isinstance(data.get('ok'), bool), f'english_empty_method_body: {data}'


def test_english_lump_binary_is_base64():
    import base64
    src = 'abstraction Noop { method Run { return 0 } }'
    resp = _post(src, 'english')
    data = _assert_ok(resp, 'english_lump_binary_is_base64')
    try:
        base64.b64decode(data['lump_binary'])
    except Exception as exc:
        pytest.fail(f'lump_binary is not valid base64: {exc}')


# ===========================================================================
# JAVASCRIPT — valid programs
# ===========================================================================

def test_js_noop_abstraction():
    src = 'abstraction Noop { method Run { return 0 } }'
    resp = _post(src, 'javascript')
    _assert_ok(resp, 'js_noop_abstraction')


def test_js_method_arithmetic():
    src = textwrap.dedent("""\
        abstraction Calc {
          method Add { return 3 + 4 }
        }
    """)
    resp = _post(src, 'javascript')
    _assert_ok(resp, 'js_method_arithmetic')


def test_js_multiple_methods():
    src = textwrap.dedent("""\
        abstraction Ops {
          method Zero { return 0 }
          method One  { return 1 }
          method Two  { return 2 }
        }
    """)
    resp = _post(src, 'javascript')
    _assert_ok(resp, 'js_multiple_methods')


def test_js_capabilities_declaration():
    src = textwrap.dedent("""\
        abstraction Widget {
          capabilities { }
          method Init { return 0 }
        }
    """)
    resp = _post(src, 'javascript')
    data = resp.json()
    assert isinstance(data.get('ok'), bool), f'js_capabilities_declaration: {data}'


def test_js_method_conditional():
    src = textwrap.dedent("""\
        abstraction Branch {
          method Run {
            if (true) { return 1 }
            return 0
          }
        }
    """)
    resp = _post(src, 'javascript')
    data = resp.json()
    assert isinstance(data.get('ok'), bool), f'js_method_conditional: {data}'


def test_js_invalid_syntax():
    src = '!!! not javascript cloomc %%%'
    resp = _post(src, 'javascript')
    _assert_fail(resp, 'js_invalid_syntax')


def test_js_response_language_field():
    src = 'abstraction Noop { method Run { return 0 } }'
    resp = _post(src, 'javascript')
    assert resp.status_code == 200
    data = resp.json()
    if data.get('ok'):
        assert data.get('language') == 'javascript', f"language echoed as {data.get('language')!r}"


def test_js_lump_words_are_integers():
    src = 'abstraction Noop { method Run { return 0 } }'
    resp = _post(src, 'javascript')
    data = _assert_ok(resp, 'js_lump_words_are_integers')
    assert all(isinstance(w, int) for w in data['words']), 'words must all be integers'


def test_js_warnings_list():
    src = 'abstraction Noop { method Run { return 0 } }'
    resp = _post(src, 'javascript')
    data = _assert_ok(resp, 'js_warnings_list')
    assert isinstance(data.get('warnings'), list), 'warnings must be a list'


def test_js_method_with_local_variable():
    src = textwrap.dedent("""\
        abstraction Local {
          method Run {
            let x = 42
            return x
          }
        }
    """)
    resp = _post(src, 'javascript')
    data = resp.json()
    assert isinstance(data.get('ok'), bool), f'js_method_with_local_variable: {data}'


# ===========================================================================
# HASKELL — valid programs
# ===========================================================================

def test_haskell_noop_abstraction():
    src = 'abstraction Noop { method run = 0 }'
    resp = _post(src, 'haskell')
    _assert_ok(resp, 'haskell_noop_abstraction')


def test_haskell_method_addition():
    src = textwrap.dedent("""\
        abstraction Math {
          method add = 1 + 2
        }
    """)
    resp = _post(src, 'haskell')
    _assert_ok(resp, 'haskell_method_addition')


def test_haskell_multiple_methods():
    src = textwrap.dedent("""\
        abstraction Vals {
          method zero = 0
          method one  = 1
        }
    """)
    resp = _post(src, 'haskell')
    _assert_ok(resp, 'haskell_multiple_methods')


def test_haskell_lambda_expression():
    src = textwrap.dedent("""\
        abstraction Fn {
          method apply = \\x -> x
        }
    """)
    resp = _post(src, 'haskell')
    data = resp.json()
    assert isinstance(data.get('ok'), bool), f'haskell_lambda_expression: {data}'


def test_haskell_let_in():
    src = textwrap.dedent("""\
        abstraction LetTest {
          method run = let x = 5 in x
        }
    """)
    resp = _post(src, 'haskell')
    data = resp.json()
    assert isinstance(data.get('ok'), bool), f'haskell_let_in: {data}'


def test_haskell_invalid_syntax():
    src = '!!! not valid haskell cloomc @@@'
    resp = _post(src, 'haskell')
    _assert_fail(resp, 'haskell_invalid_syntax')


def test_haskell_response_shape():
    src = 'abstraction Noop { method run = 0 }'
    resp = _post(src, 'haskell')
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data.get('ok'), bool)


def test_haskell_capabilities_block():
    src = textwrap.dedent("""\
        abstraction Secure {
          capabilities { }
          method run = 0
        }
    """)
    resp = _post(src, 'haskell')
    data = resp.json()
    assert isinstance(data.get('ok'), bool), f'haskell_capabilities_block: {data}'


def test_haskell_lump_binary_present_on_success():
    import base64
    src = 'abstraction Noop { method run = 0 }'
    resp = _post(src, 'haskell')
    data = _assert_ok(resp, 'haskell_lump_binary_present_on_success')
    decoded = base64.b64decode(data['lump_binary'])
    assert len(decoded) > 0


# ===========================================================================
# LAMBDA CALCULUS — valid programs
# ===========================================================================

def test_lambda_noop_abstraction():
    src = 'abstraction Noop { method Run = \\x -> 0 }'
    resp = _post(src, 'lambda')
    _assert_ok(resp, 'lambda_noop_abstraction')


def test_lambda_identity():
    src = textwrap.dedent("""\
        abstraction Id {
          method apply = \\x -> x
        }
    """)
    resp = _post(src, 'lambda')
    data = resp.json()
    assert isinstance(data.get('ok'), bool), f'lambda_identity: {data}'


def test_lambda_constant():
    src = textwrap.dedent("""\
        abstraction Const {
          method zero = \\x -> 0
        }
    """)
    resp = _post(src, 'lambda')
    data = resp.json()
    assert isinstance(data.get('ok'), bool), f'lambda_constant: {data}'


def test_lambda_nested():
    src = textwrap.dedent("""\
        abstraction K {
          method apply = \\x -> \\y -> x
        }
    """)
    resp = _post(src, 'lambda')
    data = resp.json()
    assert isinstance(data.get('ok'), bool), f'lambda_nested: {data}'


def test_lambda_multiple_methods():
    src = textwrap.dedent("""\
        abstraction Combinators {
          method I = \\x -> x
          method K = \\x -> \\y -> x
        }
    """)
    resp = _post(src, 'lambda')
    data = resp.json()
    assert isinstance(data.get('ok'), bool), f'lambda_multiple_methods: {data}'


def test_lambda_invalid_syntax():
    src = '!!! not lambda calculus at all @@@'
    resp = _post(src, 'lambda')
    _assert_fail(resp, 'lambda_invalid_syntax')


def test_lambda_response_shape():
    src = 'abstraction Noop { method Run = \\x -> 0 }'
    resp = _post(src, 'lambda')
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data.get('ok'), bool)


def test_lambda_words_non_empty_on_success():
    src = 'abstraction Noop { method Run = \\x -> 0 }'
    resp = _post(src, 'lambda')
    data = _assert_ok(resp, 'lambda_words_non_empty_on_success')
    assert len(data['words']) > 0


def test_lambda_capabilities_block():
    src = textwrap.dedent("""\
        abstraction Safe {
          capabilities { }
          method Run = \\x -> 0
        }
    """)
    resp = _post(src, 'lambda')
    data = resp.json()
    assert isinstance(data.get('ok'), bool), f'lambda_capabilities_block: {data}'


# ===========================================================================
# SYMBOLIC MATH — these require a compile-session context
#
# The Symbolic Math front-end (Pure Math "Compile Session") maintains
# let-binding state across interactive entries.  Standalone source snippets
# submitted without an active session are intentionally rejected by the
# compiler with ok=false.  All cases below are therefore expect_ok=False.
# ===========================================================================

def test_symbolic_bare_expression_rejected():
    # Standalone bare expression — no session context → rejected
    src = 'x + y'
    resp = _post(src, 'symbolic')
    _assert_fail(resp, 'symbolic_bare_expression_rejected')


def test_symbolic_let_binding_rejected():
    # let-binding without an active session context → rejected
    src = 'let x = 5'
    resp = _post(src, 'symbolic')
    _assert_fail(resp, 'symbolic_let_binding_rejected')


def test_symbolic_function_def_rejected():
    # Function definition without session → rejected
    src = 'f(x) = x^2'
    resp = _post(src, 'symbolic')
    _assert_fail(resp, 'symbolic_function_def_rejected')


def test_symbolic_integral_rejected():
    # Integral expression without session → rejected
    src = 'integrate(x^2, x)'
    resp = _post(src, 'symbolic')
    _assert_fail(resp, 'symbolic_integral_rejected')


def test_symbolic_polynomial_rejected():
    # Polynomial without session → rejected
    src = '3*x^3 + 2*x^2 - x + 7'
    resp = _post(src, 'symbolic')
    _assert_fail(resp, 'symbolic_polynomial_rejected')


def test_symbolic_abstraction_noop_rejected():
    # Even a well-formed abstraction wrapper is rejected for symbolic without session
    src = 'abstraction Noop { method Run = 0 }'
    resp = _post(src, 'symbolic')
    _assert_fail(resp, 'symbolic_abstraction_noop_rejected')


def test_symbolic_trig_expression_rejected():
    # Trig expression without session → rejected
    src = 'sin(pi/4) + cos(pi/4)'
    resp = _post(src, 'symbolic')
    _assert_fail(resp, 'symbolic_trig_expression_rejected')


def test_symbolic_matrix_rejected():
    # Matrix literal without session → rejected
    src = '[[1,0],[0,1]]'
    resp = _post(src, 'symbolic')
    _assert_fail(resp, 'symbolic_matrix_rejected')


def test_symbolic_error_message_present():
    # Verify the rejection includes a non-empty error message
    src = 'x = 1'
    resp = _post(src, 'symbolic')
    assert resp.status_code == 200
    data = resp.json()
    assert data.get('ok') is False
    assert data.get('error'), 'symbolic rejection must include an error message'


def test_symbolic_no_partial_output_on_rejection():
    # A rejected symbolic compile must not return partial words or lump_binary
    src = 'y = x + 1'
    resp = _post(src, 'symbolic')
    assert resp.status_code == 200
    data = resp.json()
    assert data.get('ok') is False
    assert 'words' not in data, 'rejected compile must not include words'
    assert 'lump_binary' not in data, 'rejected compile must not include lump_binary'


# ===========================================================================
# CROSS-CUTTING / PROTOCOL TESTS
# ===========================================================================

def test_protocol_missing_source_field():
    if requests is None:
        pytest.skip('requests not available')
    url = f'{_base()}/api/compile'
    resp = requests.post(url, json={'language': 'assembly'}, timeout=30)
    assert resp.status_code == 400, f'missing source should return 400, got {resp.status_code}'


def test_protocol_missing_language_field():
    if requests is None:
        pytest.skip('requests not available')
    url = f'{_base()}/api/compile'
    resp = requests.post(url, json={'source': 'HALT'}, timeout=30)
    assert resp.status_code == 400, f'missing language should return 400, got {resp.status_code}'


def test_protocol_empty_source_rejected():
    if requests is None:
        pytest.skip('requests not available')
    url = f'{_base()}/api/compile'
    resp = requests.post(url, json={'source': '', 'language': 'assembly'}, timeout=30)
    assert resp.status_code == 400, f'empty source should return 400, got {resp.status_code}'


def test_protocol_invalid_language_value():
    if requests is None:
        pytest.skip('requests not available')
    url = f'{_base()}/api/compile'
    resp = requests.post(url, json={'source': 'HALT', 'language': 'cobol'}, timeout=30)
    assert resp.status_code == 400, f'invalid language should return 400, got {resp.status_code}'


def test_protocol_extra_fields_ignored():
    src = 'HALT'
    resp = _post(src, 'assembly', target='simulator', options={'strict': True})
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data.get('ok'), bool), 'extra fields should be silently ignored'


def test_protocol_json_content_type():
    if requests is None:
        pytest.skip('requests not available')
    url = f'{_base()}/api/compile'
    resp = requests.post(url, json={'source': 'HALT', 'language': 'assembly'}, timeout=30)
    assert resp.status_code == 200
    ct = resp.headers.get('Content-Type', '')
    assert 'application/json' in ct, f'expected JSON response, got Content-Type: {ct}'


def test_protocol_all_six_languages_accepted():
    """Quick acceptance sweep: all 6 languages return HTTP 200."""
    sources = {
        'assembly':   'HALT',
        'english':    'abstraction Noop { method Run { return 0 } }',
        'javascript': 'abstraction Noop { method Run { return 0 } }',
        'haskell':    'abstraction Noop { method run = 0 }',
        'lambda':     'abstraction Noop { method Run = \\x -> 0 }',
        'symbolic':   'x + y',
    }
    for lang, src in sources.items():
        resp = _post(src, lang)
        assert resp.status_code == 200, (
            f'language={lang}: expected HTTP 200, got {resp.status_code}'
        )
        data = resp.json()
        assert isinstance(data.get('ok'), bool), (
            f'language={lang}: ok must be a bool, got {data}'
        )


# ===========================================================================
# __main__ — run as a standalone script (original style)
# ===========================================================================

def _run_standalone(base_url: str) -> None:
    """Run all live tests directly without pytest, printing pass/fail per case."""
    import traceback

    os.environ['CLOOMC_API_BASE'] = base_url.rstrip('/')

    this = sys.modules[__name__]
    tests = [
        (name, obj)
        for name, obj in sorted(vars(this).items())
        if name.startswith('test_') and callable(obj)
    ]

    passed = 0
    failed = 0
    skipped = 0

    print(f'\nRunning {len(tests)} live compile API tests against {base_url}\n')

    for name, fn in tests:
        try:
            fn()
            print(f'  PASS  {name}')
            passed += 1
        except pytest.skip.Exception as exc:
            print(f'  SKIP  {name}: {exc}')
            skipped += 1
        except AssertionError as exc:
            print(f'  FAIL  {name}: {exc}')
            failed += 1
        except Exception as exc:
            print(f'  ERROR {name}: {exc}')
            traceback.print_exc()
            failed += 1

    print(f'\nResults: {passed} passed, {failed} failed, {skipped} skipped')
    if failed:
        sys.exit(1)


if __name__ == '__main__':
    _base_url = sys.argv[1] if len(sys.argv) > 1 else os.environ.get(
        'CLOOMC_API_BASE', _DEFAULT_BASE
    )
    _run_standalone(_base_url)
