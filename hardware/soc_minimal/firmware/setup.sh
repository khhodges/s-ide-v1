#!/usr/bin/env bash
# hardware/soc_minimal/firmware/setup.sh
#
# Creates all four firmware source files in the current directory,
# then builds firmware.hex and copies it to hardware/soc_minimal/.
#
# Usage (from the project root on the Chromebook):
#   bash hardware/soc_minimal/firmware/setup.sh
# or:
#   curl https://<IDE-URL>/dl/firmware-setup | bash

set -e
# When run via "curl | bash", BASH_SOURCE is empty, so always use PWD.
# Run this script from the project root (~/Downloads/church_ti60_f225_project).
PROJECT_ROOT="$PWD"
FW_DIR="$PROJECT_ROOT/hardware/soc_minimal/firmware"
mkdir -p "$FW_DIR"
echo "[setup] Writing firmware files to $FW_DIR"

# ── main.c ────────────────────────────────────────────────────────────────────
python3 - "$FW_DIR/main.c" << 'PYEOF'
import sys
path = sys.argv[1]
src = r"""/*
 * hardware/soc_minimal/firmware/main.c
 *
 * Bare-metal RISC-V firmware for the Sapphire SoC minimal UART gate test.
 * Sends "CHURCH Ti60 v1.0\r\n" on boot.  Re-sends on button press (GPIOT_N_06).
 *
 * Target: Efinix Ti60F225, Sapphire SoC, 25 MHz, 115200 baud.  No libc / OS.
 *
 * UART0 map (SpinalHDL, standard Efinix):
 *   0xF0010000 + 0x00  TX/RX data   (write = transmit byte)
 *   0xF0010000 + 0x04  Status       (bit 0 = TX ready)
 *   0xF0010000 + 0x08  clockDivider (resets to 0; MUST write before first TX)
 *
 * GPIO map (SpinalHDL, standard Efinix):
 *   0xF0020000 + 0x00  GPIO input   (bit 6 = GPIOT_N_06, active-low)
 *
 * Baud: clk / (8*(div+1)) = 25e6 / (8*27) = 115741 ~ 115200 baud
 */
#define UART_BASE      0xF0010000UL
#define UART_DATA      (*(volatile unsigned int *)(UART_BASE + 0x00))
#define UART_STATUS    (*(volatile unsigned int *)(UART_BASE + 0x04))
#define UART_CLOCKDIV  (*(volatile unsigned int *)(UART_BASE + 0x08))
#define UART_TX_READY  (UART_STATUS & 1u)
#define UART_DIV_115200  26u

#define GPIO_BASE      0xF0020000UL
#define GPIO_INPUT     (*(volatile unsigned int *)(GPIO_BASE + 0x00))
#define BUTTON_BIT     (1u << 6)
#define BUTTON_PRESSED (!(GPIO_INPUT & BUTTON_BIT))

#define DEBOUNCE_CYCLES 250000u

static void uart_putc(char c) { while (!UART_TX_READY); UART_DATA = (unsigned int)(unsigned char)c; }
static void uart_puts(const char *s) { while (*s) uart_putc(*s++); }

static int debounce_pressed(void) {
    unsigned int i;
    for (i = 0; i < DEBOUNCE_CYCLES; i++) { if (!BUTTON_PRESSED) return 0; }
    return 1;
}
static void wait_for_release(void) { while (BUTTON_PRESSED); }

int main(void) {
    UART_CLOCKDIV = UART_DIV_115200;   /* MUST be first — resets to 0 on boot */
    uart_puts("CHURCH Ti60 v1.0\r\n");
    for (;;) {
        if (BUTTON_PRESSED && debounce_pressed()) {
            uart_puts("CHURCH Ti60 v1.0\r\n");
            wait_for_release();
        }
    }
    return 0;
}
"""
with open(path, 'w') as f:
    f.write(src)
print(f"  wrote {path}")
PYEOF

# ── crt0.S ────────────────────────────────────────────────────────────────────
python3 - "$FW_DIR/crt0.S" << 'PYEOF'
import sys
path = sys.argv[1]
src = """    .section .text.startup
    .global _start
_start:
    la   sp, _stack_top
    la   t0, _bss_start
    la   t1, _bss_end
1:  bge  t0, t1, 2f
    sw   zero, 0(t0)
    addi t0, t0, 4
    j    1b
2:
    la   t0, _data_load
    la   t1, _data_start
    la   t2, _data_end
3:  bge  t1, t2, 4f
    lw   t3, 0(t0)
    sw   t3, 0(t1)
    addi t0, t0, 4
    addi t1, t1, 4
    j    3b
4:
    call main
halt:
    j    halt
"""
with open(path, 'w') as f:
    f.write(src)
print(f"  wrote {path}")
PYEOF

# ── link.ld ───────────────────────────────────────────────────────────────────
python3 - "$FW_DIR/link.ld" << 'PYEOF'
import sys
path = sys.argv[1]
src = """MEMORY {
    ROM (rx)  : ORIGIN = 0x00000000, LENGTH = 512K
    RAM (rwx) : ORIGIN = 0x00080000, LENGTH = 128K
}
ENTRY(_start)
SECTIONS {
    .text  : { *(.text.startup) *(.text*) *(.rodata*) . = ALIGN(4); } > ROM
    .data  : { _data_start = .; *(.data*) . = ALIGN(4); _data_end = .; } > RAM AT > ROM
    _data_load = LOADADDR(.data);
    .bss   : { _bss_start = .; *(.bss*) *(COMMON) . = ALIGN(4); _bss_end = .; } > RAM
    _stack_top = ORIGIN(RAM) + LENGTH(RAM);
}
"""
with open(path, 'w') as f:
    f.write(src)
print(f"  wrote {path}")
PYEOF

# ── Makefile ──────────────────────────────────────────────────────────────────
python3 - "$FW_DIR/Makefile" << 'PYEOF'
import sys
path = sys.argv[1]
src = (
    "TOOLCHAIN ?= $(HOME)/efinity/efinity-riscv-ide-2025.2/toolchain/bin\n"
    "CC        := $(TOOLCHAIN)/riscv-none-embed-gcc\n"
    "OBJCOPY   := $(TOOLCHAIN)/riscv-none-embed-objcopy\n"
    "CFLAGS := -march=rv32im -mabi=ilp32 -O2 -nostdlib -ffreestanding -Wall -Wextra\n"
    "SRCS   := crt0.S main.c\n"
    "TARGET := firmware\n"
    ".PHONY: all clean\n"
    "all: $(TARGET).hex\n"
    "$(TARGET).elf: $(SRCS) link.ld\n"
    "\t$(CC) $(CFLAGS) -T link.ld -o $@ $(SRCS)\n"
    "$(TARGET).hex: $(TARGET).elf\n"
    "\t$(OBJCOPY) -O ihex $< $@\n"
    "clean:\n"
    "\trm -f $(TARGET).elf $(TARGET).hex\n"
)
with open(path, 'w') as f:
    f.write(src)
print(f"  wrote {path}")
PYEOF

echo "[setup] Building firmware..."
TOOLCHAIN="$HOME/efinity/efinity-riscv-ide-2025.2/toolchain/bin"
make -C "$FW_DIR" TOOLCHAIN="$TOOLCHAIN"

HEX="$FW_DIR/firmware.hex"
if [ -f "$HEX" ]; then
    cp "$HEX" "$PROJECT_ROOT/hardware/soc_minimal/firmware.hex"
    echo "[setup] SUCCESS — firmware.hex written to $PROJECT_ROOT/hardware/soc_minimal/firmware.hex"
    echo "[setup] Next step: open Efinity, compile (Map+PnR+Bitstream), then flash."
else
    echo "[setup] ERROR: firmware.hex not produced. Check gcc output above."
    exit 1
fi
