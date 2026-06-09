/*
 * hardware/soc_minimal/firmware/link.ld
 *
 * Linker script for Sapphire SoC bare-metal firmware.
 *
 * Memory map for this Sapphire SoC IP (from sapphire.v address decoder):
 *   ROM  0xF9000000  16 KB  (.text + .rodata; CPU reset vector = 0xF9000000)
 *   RAM  0xF9004000  16 KB  (.data + .bss + stack)
 *
 * Total on-chip SRAM = 32 KB (0xF9000000 – 0xF9007FFF).
 *
 * Peripheral bus base: 0xF8000000
 *   UART0:  0xF8010000
 *   GPIO0:  0xF8020000
 */

MEMORY
{
    ROM (rx)  : ORIGIN = 0xF9000000, LENGTH = 16K
    RAM (rwx) : ORIGIN = 0xF9004000, LENGTH = 16K
}

ENTRY(_start)

SECTIONS
{
    .text : {
        *(.text.startup)
        *(.text*)
        *(.rodata*)
        . = ALIGN(4);
    } > ROM

    .data : {
        _data_start = .;
        *(.data*)
        . = ALIGN(4);
        _data_end = .;
    } > RAM AT > ROM

    _data_load = LOADADDR(.data);

    .bss : {
        _bss_start = .;
        *(.bss*)
        *(COMMON)
        . = ALIGN(4);
        _bss_end = .;
    } > RAM

    _stack_top = ORIGIN(RAM) + LENGTH(RAM);
}
