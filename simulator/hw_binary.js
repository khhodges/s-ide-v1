const HW_BOOT_PROGRAM = [
    0x27440001, // PC=0  CHANGE CR8, CR8, 1
    0x070B0000, // PC=1  LOAD CR1, [CR6 + 0]
    0x07130001, // PC=2  LOAD CR2, [CR6 + 1]
    0x37100003, // PC=3  TPERM CR2, X
    0x3F100000, // PC=4  LAMBDA CR2
    0x07030006, // PC=5  LOAD CR0, [CR6 + 6]
    0x37000008, // PC=6  TPERM CR0, E
    0x17000000, // PC=7  CALL CR0
    0x073B0001, // PC=8  LOAD CR7, [CR6 + 1]
    0x37380003, // PC=9  TPERM CR7, X
    0x3F380000, // PC=10 LAMBDA CR7
    0x1F028000, // PC=11 RETURN CR5
    0x0F308002, // PC=12 SAVE [CR6 + 2], CR1
];

const HW_NAMESPACE = [
    0x0000FD00, 0x80000008, 0x00000000, // Slot 0: Boot.NS (NS_TABLE_BASE=0xFD00)
    0x00000100, 0x80000008, 0x00000000, // Slot 1: Boot.Thread
    0x00000200, 0x80000008, 0x00000000, // Slot 2: Boot.CList
    0x00000300, 0x80000008, 0x00000000, // Slot 3: Boot.CLOOMC
    0x00000400, 0x80000008, 0x00000000, // Slot 4: Salvation
    0x00000500, 0x80000008, 0x00000000, // Slot 5: Mint
    0x00000600, 0x80000008, 0x00000000, // Slot 6: Memory
    0x00000700, 0x80000008, 0x00000000, // Slot 7: Scheduler
    0x00000800, 0x80000008, 0x00000000, // Slot 8: Stack
    0x00000900, 0x80000008, 0x00000000, // Slot 9: UART
    0x00000A00, 0x80000008, 0x00000000, // Slot 10: LED
    0x00000B00, 0x80000008, 0x00000000, // Slot 11: Button
    0x00000C00, 0x80000008, 0x00000000, // Slot 12: Timer
    0x00000D00, 0x80000008, 0x00000000, // Slot 13: Display
    0x00000E00, 0x80000008, 0x00000000, // Slot 14: SlideRule
    0x00000F00, 0x80000008, 0x00000000, // Slot 15: Abacus
];

const HW_CLIST = [
    0x00000314, // CList[0] Inform RX  -> NS idx 3 (Boot.CLOOMC)
    0x00000410, // CList[1] Inform X   -> NS idx 4 (Salvation)
    0x00000002, // CList[2] NULL       (SAVE target)
    0x00000280, // CList[3] Inform E   -> NS idx 2 (Boot.CList)
    0x00000580, // CList[4] Inform E   -> NS idx 5 (Mint)
    0x00000620, // CList[5] Inform L   -> NS idx 6 (Memory)
    0x00000480, // CList[6] Inform E   -> NS idx 4 (Salvation CALL target)
    0x00000002, // CList[7] NULL
];

const HW_SALVATION_CLIST = [
    0x00000510, // Slot 0: Inform X -> NS idx 5 (Salvation.CLOOMC)
    0x00000680, // Slot 1: Inform E -> NS idx 6 (reference)
];

const HW_SALVATION_CODE = [
    0x070B0000, // PC=0  LOAD CR1, [CR6 + 0]
    0x07130001, // PC=1  LOAD CR2, [CR6 + 1]
    0x37080003, // PC=2  TPERM CR1, X
    0x3F080000, // PC=3  LAMBDA CR1
    0x1F028000, // PC=4  RETURN CR5
];

const HW_NS_LABELS = {
    0: 'Boot.NS',
    1: 'Boot.Thread',
    2: 'Boot.CList',
    3: 'Boot.CLOOMC',
    4: 'Salvation',
    5: 'Mint',
    6: 'Memory',
    7: 'Scheduler',
    8: 'Stack',
    9: 'UART',
    10: 'LED',
    11: 'Button',
    12: 'Timer',
    13: 'Display',
    14: 'SlideRule',
    15: 'Abacus',
};

const TANG_NANO_20K = {
    name: 'Tang Nano 20K',
    fpga: 'GW2AR-LV18QN88C8/I7',
    family: 'Gowin GW2AR',
    clockMHz: 27,
    bsram: '41472 bits (BSRAM)',
    luts: 20736,
    uartBridge: 'BL616 USB-C',
    leds: 6,
    buttons: 2,
    hdmi: true,
    sdram: '64Mbit SDRAM',
    flash: '32Mbit NOR Flash',
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        HW_BOOT_PROGRAM, HW_NAMESPACE, HW_CLIST,
        HW_SALVATION_CLIST, HW_SALVATION_CODE, HW_NS_LABELS,
        TANG_NANO_20K
    };
}
