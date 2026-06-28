#!/bin/bash
# run_efx_map.sh — Efinix synthesis for SoC+CM combined project
#
# Usage (from any directory):
#   bash ~/church-machine/hardware/soc_combined/run_efx_map.sh [PROJECT_XML]
#
# PROJECT_XML defaults to church_soc_cm.xml in the same directory as this script.
#
# Uses efx_run.py --flow map (NOT efx_map --project-xml directly).
# efx_run.py produces the .vdb file required by efx_pnr; bare efx_map does not.
#
# Efinity re-injects banned params into the XML on every GUI save; this script
# strips them automatically before invoking efx_run.py.
#
# Known banned params (cause EFX-0002 in 2026.1):
#   infer_clk_enable, infer_set_reset, calc_mcw, split_input_buf,
#   no_fanout_override, get_names_method, logic_opting, pack_lut_into_ram,
#   cpe_ins_register, use_cpe_for_const_0, use_cpe_for_const_1,
#   fanout_limit (renamed to --fanout-limit with hyphens)

set -euo pipefail

EFINITY="${EFINITY_HOME:-$HOME/efinity/2026.1}"
EFX_RUN_PY="$EFINITY/scripts/efx_run.py"

# Do NOT source setup.sh — it calls `exit` in non-interactive shells and
# silently kills this script before it prints anything.  Add paths directly.
export PATH="$EFINITY/bin:${PATH:-}"
export EFINITY_HOME="$EFINITY"
if [ -d "$EFINITY/lib" ]; then
    export LD_LIBRARY_PATH="$EFINITY/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

# Default project: church_soc_cm.xml in the same directory as this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="${1:-$SCRIPT_DIR/church_soc_cm.xml}"
SOC_DIR="$(dirname "$PROJECT")"
CIRCUIT="$(basename "$PROJECT" .xml)"

echo "==> Stripping banned XML params from $PROJECT ..."
sed -i '/<efx:param name="infer_clk_enable"/d'    "$PROJECT"
sed -i '/<efx:param name="infer_set_reset"/d'     "$PROJECT"
sed -i '/<efx:param name="calc_mcw"/d'            "$PROJECT"
sed -i '/<efx:param name="split_input_buf"/d'     "$PROJECT"
sed -i '/<efx:param name="no_fanout_override"/d'  "$PROJECT"
sed -i '/<efx:param name="get_names_method"/d'    "$PROJECT"
sed -i '/<efx:param name="logic_opting"/d'        "$PROJECT"
sed -i '/<efx:param name="pack_lut_into_ram"/d'   "$PROJECT"
sed -i '/<efx:param name="cpe_ins_register"/d'    "$PROJECT"
sed -i '/<efx:param name="use_cpe_for_const_0"/d' "$PROJECT"
sed -i '/<efx:param name="use_cpe_for_const_1"/d' "$PROJECT"
sed -i '/<efx:param name="fanout_limit"/d'        "$PROJECT"
echo "    Done."
echo ""

echo "==> Synthesising $PROJECT via efx_run.py --flow map ..."
echo "    efx_run.py: $EFX_RUN_PY"
echo "    Project:    $PROJECT"
echo "    Working in: $SOC_DIR"
echo ""

mkdir -p "$SOC_DIR/work_syn"
cd "$SOC_DIR"

# efx_run.py --flow map runs synthesis AND writes outflow/*.vdb (required by efx_pnr).
# --work_dir sets the scratch directory; output lands in outflow/ as per the project XML.
python3 "$EFX_RUN_PY" \
    --flow map \
    --work_dir work_syn \
    --prj "$PROJECT" \
    2>&1 | tee "$SOC_DIR/work_syn/synthesis.log"

echo ""
echo "==> Synthesis complete. VDB and netlist in $SOC_DIR/outflow/"
echo "    Next: bash ~/church-machine/hardware/soc_combined/run_efx_pnr.sh $PROJECT"
echo ""
echo "    Verify BRAM init is non-zero:"
echo "    grep -m1 'INIT_0' $SOC_DIR/outflow/${CIRCUIT}.map.v 2>/dev/null | head -c 120"
