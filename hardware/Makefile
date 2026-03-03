# Church Machine — Tang Nano 20K build (Yosys + NextPNR-Gowin + Gowin Pack)
#
# Prerequisites:
#   Install oss-cad-suite (includes yosys, nextpnr-gowin, gowin_pack)
#   Or: sudo apt install yosys && build nextpnr-gowin from source
#
# Usage:
#   make verilog   — generate Verilog from Amaranth
#   make synth     — synthesize with Yosys
#   make pnr       — place and route with NextPNR-Gowin
#   make pack      — create bitstream with gowin_pack
#   make prog      — upload to Tang Nano 20K via openFPGALoader
#   make all       — full build chain
#   make clean     — remove build artifacts

DEVICE   := GW2AR-LV18QN88C8/I7
FAMILY   := GW2A-18C
CST      := tang_nano_20k.cst

BUILD    := ../build
FREQ_MHZ := 27

PROJ     := church_tang_nano_20k
VERILOG  := $(BUILD)/$(PROJ).v
JSON     := $(BUILD)/$(PROJ).json
PACK     := $(BUILD)/$(PROJ).fs
TIMING   := $(BUILD)/$(PROJ)_timing.txt

.PHONY: all verilog synth pnr pack prog clean report

all: pack

verilog:
	cd .. && python -m hardware.gen_verilog

synth: $(JSON)
$(JSON): $(VERILOG) $(CST)
	@mkdir -p $(BUILD)
	yosys -p "read_verilog $(VERILOG); synth_gowin -top top -json $(JSON)" > $(BUILD)/synth.log 2>&1
	@echo "=== Resource usage ==="
	@grep -A 20 "Printing statistics" $(BUILD)/synth.log || true

pnr: $(PACK)
$(PACK): $(JSON)
	nextpnr-gowin \
		--json $(JSON) \
		--write $(BUILD)/$(PROJ)_pnr.json \
		--device $(DEVICE) \
		--family $(FAMILY) \
		--cst $(CST) \
		--freq $(FREQ_MHZ) \
		2>&1 | tee $(BUILD)/pnr.log
	gowin_pack -d $(FAMILY) -o $(PACK) $(BUILD)/$(PROJ)_pnr.json

pack: $(PACK)

prog: $(PACK)
	@echo "=== Upload to Tang Nano 20K ==="
	openFPGALoader -b tangnano20k $(PACK)

clean:
	rm -f $(JSON) $(PACK) $(TIMING)
	rm -f $(BUILD)/synth.log $(BUILD)/pnr.log $(BUILD)/$(PROJ)_pnr.json

report: $(JSON)
	@echo "=== Gowin GW2AR-18 Synthesis Report ==="
	@grep -E "LUT|DFF|BSRAM|ALU|DSP|Number" $(BUILD)/synth.log || true
