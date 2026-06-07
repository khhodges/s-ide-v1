#!/bin/bash
set -e
cd ~/church_project/SoC

echo "=== Step 1: Compile firmware ==="
cd firmware && touch main.c && make && cd ..

echo "=== Step 2: Patch sapphire.v ==="
python3 scripts/patch_sapphire_init.py sapphire.v \
    EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol0.bin \
    EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol1.bin \
    EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol2.bin \
    EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol3.bin

echo "=== Step 3: Setup Efinity 2025.2 environment ==="
export EFINITY_HOME=/home/sipantichijk/efinity/2025.2
export PYTHONHOME=$EFINITY_HOME
export EFINITY_USER_DIR_INI=/home/sipantichijk/.local/share/efinity/user_dir.ini
export EFXPT_HOME=$EFINITY_HOME/pt
source $EFINITY_HOME/bin/setup.sh

echo "=== Step 4: Synthesis (efx_run.py map — processes peri.xml correctly) ==="
python3 $EFINITY_HOME/scripts/efx_run.py --flow map --work_dir work_syn --prj church_soc_cm.xml

echo "=== Step 5: Place and Route ==="
/home/sipantichijk/efinity/2025.2/bin/efx_pnr \
    --circuit church_soc_cm --family Titanium --device Ti60F225 \
    --operating_conditions C3 \
    --vdb_file outflow/church_soc_cm.vdb --use_vdb_file on \
    --prj church_soc_cm.xml --output_dir outflow --work_dir work_pnr \
    --place_file outflow/church_soc_cm.place --route_file outflow/church_soc_cm.route \
    --sdc_file church_soc_cm.sdc \
    --sync_file outflow/church_soc_cm.interface.csv

echo "=== Step 6: Bitstream generation ==="
python3 $EFINITY_HOME/scripts/efx_run.py --flow pgm --prj church_soc_cm.xml

echo "=== Step 7: Flash ==="
unset PYTHONHOME
sudo /usr/bin/openFPGALoader -b titanium_ti60_f225_jtag -f outflow/church_soc_cm.hex

echo "=== Done — press RESET on board, monitor: stty -F /dev/ttyUSB2 57600 raw -echo && cat /dev/ttyUSB2 ==="
