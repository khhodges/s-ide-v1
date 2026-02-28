const HW_BOOT_PROGRAM = [
    0x070B0000, // 0x0000 LOAD CR1, [CR6 + 0]
    0x07130001, // 0x0004 LOAD CR2, [CR6 + 1]
    0x37100003, // 0x0008 TPERM CR2, X
    0x3F100000, // 0x000C LAMBDA CR2
    0x07030001, // 0x0010 LOAD CR0, [CR6 + 1]
    0x37000008, // 0x0014 TPERM CR0, E
    0x17000000, // 0x0018 CALL CR0
    0x073B0001, // 0x001C LOAD CR7, [CR6 + 1]
    0x37380003, // 0x0020 TPERM CR7, X
    0x3F380000, // 0x0024 LAMBDA CR7
    0x1F028000, // 0x0028 RETURN CR5
    0x0F308002, // 0x002C SAVE [CR6 + 2], CR1
];

const HW_NAMESPACE = [
    0x0000FD00, 0x80000008, 0x00000000, // Slot 0: Boot.NS (NS_TABLE_BASE=0xFD00)
    0x00000100, 0x80000008, 0x00000000, // Slot 1: Thread
    0x00000200, 0x80000008, 0x00000000, // Slot 2: Boot.Abstraction
    0x00000300, 0x80000008, 0x00000000, // Slot 3: Boot.CLOOMC
    0x00000400, 0x80000008, 0x00000000, // Slot 4: Abstraction 4
    0x00000500, 0x80000008, 0x00000000, // Slot 5: Abstraction 5
    0x00000600, 0x80000008, 0x00000000, // Slot 6: Abstraction 6
    0x00000700, 0x80000008, 0x00000000, // Slot 7: Abstraction 7
    0x00000800, 0x80000008, 0x00000000, // Slot 8: Abstraction 8
    0x00000900, 0x80000008, 0x00000000, // Slot 9: Abstraction 9
    0x00000A00, 0x80000008, 0x00000000, // Slot 10: Abstraction 10
    0x00000B00, 0x80000008, 0x00000000, // Slot 11: Abstraction 11
    0x00000C00, 0x80000008, 0x00000000, // Slot 12: Abstraction 12
    0x00000D00, 0x80000008, 0x00000000, // Slot 13: Abstraction 13
    0x00000E00, 0x80000008, 0x00000000, // Slot 14: Abstraction 14
    0x00000F00, 0x80000008, 0x00000000, // Slot 15: Abstraction 15
];

const HW_CLIST = [
    0x00000314, // CList[0] Inform RX  → NS idx 3 (Boot.CLOOMC)
    0x00000490, // CList[1] Inform XE  → NS idx 4
    0x00000002, // CList[2] NULL
    0x00000280, // CList[3] Inform E   → NS idx 2 (Boot.Abstraction)
    0x00000580, // CList[4] Inform E   → NS idx 5
    0x00000620, // CList[5] Inform L   → NS idx 6
    0x00000002, // CList[6] NULL
    0x00000002, // CList[7] NULL
];

const HW_NS_LABELS = {
    0: 'Boot.NS',
    1: 'Boot.Thread',
    2: 'Boot.Abstraction',
    3: 'Boot.CLOOMC',
    4: 'Slot 4',
    5: 'Slot 5',
    6: 'Slot 6',
    7: 'Slot 7',
    8: 'Slot 8',
    9: 'Slot 9',
    10: 'Slot 10',
    11: 'Slot 11',
    12: 'Slot 12',
    13: 'Slot 13',
    14: 'Slot 14',
    15: 'Slot 15',
};
