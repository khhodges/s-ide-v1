/*
 * hardware/soc_minimal/firmware/main.c
 *
 * Bare-metal RISC-V firmware for the Sapphire SoC minimal UART gate test.
 * On boot:  sends "CHURCH Ti60 v1.0\r\n" over UART0.
 * On press: re-sends the same greeting each time the push button is pressed
 *           (GPIOT_N_06, active-low), allowing repeat tests without
 *           reprogramming or power-cycling the board.
 *
 * Target: Efinix Ti60F225, Sapphire SoC, 25 MHz, 115200 baud
 * No libc, no OS.
 *
 * Sapphire SoC UART0 register map (SpinalHDL UART, standard Efinix addresses):
 *   0xF0010000 + 0x00  TX/RX data    (write = transmit byte)
 *   0xF0010000 + 0x04  Status        (bit 0 = TX not full / ready to accept byte)
 *   0xF0010000 + 0x08  clockDivider  (resets to 0x00 = clk/8; MUST be written
 *                                     before first TX; 26 = 115200 @ 25 MHz)
 *
 * Sapphire SoC GPIO register map (SpinalHDL GPIO, standard Efinix addresses):
 *   0xF0020000 + 0x00  GPIO input register (read: current pin levels)
 *   0xF0020000 + 0x04  GPIO output register
 *   0xF0020000 + 0x08  GPIO output-enable register
 *
 *   GPIOT_N_06 is exposed at bit 6 of the GPIO input register.
 *   The pin is pulled high (hardware weak pull-up assigned in church_soc.peri.xml);
 *   pressing the button drives it low (active-low).
 *
 * If sapphire_define.vh shows a different UART0 or GPIO base, update the
 * UART_BASE / GPIO_BASE defines below.
 *
 * Debounce: 250,000 clock cycles = ~10 ms at 25 MHz.  The firmware waits
 * for the button to remain stable at "pressed" for the full debounce window
 * before retransmitting, then waits for full release before re-arming.
 */

/* ------------------------------------------------------------------ */
/* UART0                                                               */
/*                                                                     */
/* The Sapphire SoC UART clockDivider register resets to 0x00, which  */
/* makes the UART run at clk/8 = 3.125 Mbaud (silence).  Firmware     */
/* MUST write UART_CLOCKDIV before the first uart_puts() call.         */
/*                                                                     */
/* Baud rate formula:  baudRate = clk / (8 × (clockDivider + 1))      */
/*   25 MHz, 115200 baud:  clockDivider = 26                           */
/*     → 25,000,000 / (8 × 27) = 115,741 ≈ 115,200 ✓                 */
/* ------------------------------------------------------------------ */
#define UART_BASE      0xF0010000UL
#define UART_DATA      (*(volatile unsigned int *)(UART_BASE + 0x00))
#define UART_STATUS    (*(volatile unsigned int *)(UART_BASE + 0x04))
#define UART_CLOCKDIV  (*(volatile unsigned int *)(UART_BASE + 0x08))
#define UART_TX_READY  (UART_STATUS & 1u)

/* clockDivider value for 115200 baud at 25 MHz (no PLL) */
#define UART_DIV_115200  26u

/* ------------------------------------------------------------------ */
/* GPIO                                                                */
/*   Typical Sapphire SoC value: APB_GPIO_BASE = 0xF0020000            */
/*   Verify against sapphire_define.vh before synthesis.               */
/* ------------------------------------------------------------------ */
#define GPIO_BASE      0xF0020000UL
#define GPIO_INPUT     (*(volatile unsigned int *)(GPIO_BASE + 0x00))

/* GPIOT_N_06 → bit 6 of GPIO_INPUT; active-low (0 = pressed) */
#define BUTTON_BIT     (1u << 6)
#define BUTTON_PRESSED (!(GPIO_INPUT & BUTTON_BIT))

/* ------------------------------------------------------------------ */
/* Debounce                                                            */
/*   250,000 cycles × (1 / 25 MHz) = 10 ms                            */
/* ------------------------------------------------------------------ */
#define DEBOUNCE_CYCLES 250000u

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
static void uart_putc(char c)
{
    while (!UART_TX_READY)
        ;
    UART_DATA = (unsigned int)(unsigned char)c;
}

static void uart_puts(const char *s)
{
    while (*s)
        uart_putc(*s++);
}

/*
 * debounce_pressed() — confirm the button is held for DEBOUNCE_CYCLES.
 * Returns 1 if the button stayed pressed for the full window; 0 if it
 * bounced back high before the window elapsed.
 */
static int debounce_pressed(void)
{
    unsigned int i;
    for (i = 0; i < DEBOUNCE_CYCLES; i++) {
        if (!BUTTON_PRESSED)
            return 0;   /* released during window — treat as bounce */
    }
    return 1;
}

/*
 * wait_for_release() — spin until the button is no longer pressed.
 * Prevents a single long press from re-sending the greeting multiple times.
 */
static void wait_for_release(void)
{
    while (BUTTON_PRESSED)
        ;
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */
int main(void)
{
    /* Set baud rate — MUST happen before any uart_puts().
     * The UART clockDivider register resets to 0x00 (clk/8 = 3.125 Mbaud).
     * Writing 26 gives 115200 baud at the 25 MHz system clock (no PLL).  */
    UART_CLOCKDIV = UART_DIV_115200;

    /* Boot greeting — sent once unconditionally at startup */
    uart_puts("CHURCH Ti60 v1.0\r\n");

    /* Button-retransmit loop */
    for (;;) {
        /* Wait for the button to be pressed (active-low) */
        if (BUTTON_PRESSED) {
            /* Confirm it is a real press, not a bounce */
            if (debounce_pressed()) {
                uart_puts("CHURCH Ti60 v1.0\r\n");
                /* Wait for full release before re-arming */
                wait_for_release();
            }
        }
    }

    return 0;
}
