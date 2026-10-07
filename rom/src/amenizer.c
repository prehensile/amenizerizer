/*
 * Amenizer, reimplemented in C for GBDK-2020.
 *
 * A source-level reconstruction of nitro2k01's 2013 ROM (md5
 * fd6c84c0faf9c8b5ebd84b0351af9619). Every behaviour below was read from the
 * original's disassembly; addresses in comments are ROM offsets unless they
 * start with $C0, in which case they are the WRAM copy of the engine (ROM
 * 0x033F-0x0406 copied to $C000). notes/rom-behaviour.md has the write-up.
 *
 * The original is self-modifying: the timer ISR runs from WRAM and the VBlank
 * handler patches its operands. Each patched operand is a plain variable here.
 *
 * The break, slice tables and boot rate are not part of this file. They are
 * extracted from an existing cartridge at build time (tools/extract_assets.py);
 * the break and tables go back at their original addresses, 0x4000 and 0x3F00.
 */

#include <gb/gb.h>
#include <gb/hardware.h>
#include <gb/isr.h>
#include <stdint.h>

#define SAMPLE_BASE 0x4000u

/* From tools/extract_assets.py, so a cartridge the web app has patched
 * rebuilds with its own break, tables and rate. */
extern const uint8_t slice_tables[256]; /* 0x3F00 */
extern const uint8_t boot_tma;          /* operand of `ld a,$ad` at 0x0169 */

/* ---- state the timer ISR reads ------------------------------------------ */

/* $C001-$C002: operand of `ld hl,$4000`, the next 16 bytes to play. */
static volatile uint16_t play_ptr = SAMPLE_BASE;
/* $C056: operand of `and $7f` applied to the pointer's high byte. The ROM image
 * holds $7F, but VBlank overwrites it with $FF (or the repeater mask) every
 * frame, so $7F only ever applies before the first VBlank. */
static volatile uint8_t ptr_mask = 0x7F;
/* $C0C8 frame counter (+4 per IRQ, a slice is 64 IRQs) and $C0C9 sequencer step. */
static volatile uint8_t frame_counter;
static volatile uint8_t seq_step;
/* $C0CC: table select, the raw d-pad mask. */
static volatile uint8_t table_sel;
/* $C090: the `jr` operand that is $0E (skip the envelope) or $00 (run it). */
static volatile uint8_t envelope_on;
/* $C092: the second `jr` operand -- how many of the four `add hl,hl` to skip.
 * The ROM image holds 4, so the envelope starts with no doublings. */
static volatile uint8_t envelope_skip = 4;
/* $C043: a `nop` that Start+Select toggles to `cpl` (xor $2F). As `cpl` it
 * inverts TMA on its way into NR33, detuning the wave from the reload.
 * Here: $00 or $FF, XORed into TMA. */
static volatile uint8_t nr33_xor;

/* ---- state only the VBlank logic touches -------------------------------- */

static uint8_t joy_held;    /* $C0CB */
static uint8_t joy_pressed; /* $C0CA */
static uint8_t repeat_depth; /* $C0CD, 1..3 */

/*
 * Timer ISR -- the WRAM routine at $C000, entered via ROM 0x0050 -> 0x027E.
 * Fires every 256-TMA ticks of the 65536 Hz timer, which is exactly 32 steps
 * of the wave channel once NR33/NR34 are set from the same TMA.
 */
static void timer_isr(void) __critical __interrupt
{
    uint8_t a;

    BGP_REG = 0xFF; /* 0x027E: blacken the screen for the ISR's duration */

    /*
     * Mute ch3 and switch its DAC off so wave RAM is writable, reload it,
     * then retrigger. $C005-$C04D, instruction for instruction.
     *
     * This stays in assembly because its length is audible: the channel
     * outputs nothing between NR51=$BB and NR51=$FF, a gap of ~100 M-cycles
     * per frame that is part of the original's sound. SDCC's unrolled C
     * copy takes about twice as long, which the comparison against the
     * original (tools/compare.py) picks up as a louder ~790 Hz buzz.
     *
     * The original's `nop` at $C043 becomes `cpl` under Start+Select; here
     * `xor b` with b = $00 or $FF does the same in the same single cycle.
     *
     * freq = 0x700 | TMA, so the wave steps at 2097152 / (256 - TMA) Hz,
     * the same divisor as the timer.
     */
    __asm
        ld      hl, #_play_ptr
        ld      a, (hl+)
        ld      h, (hl)
        ld      l, a
        ld      a, (#_nr33_xor)
        ld      b, a
        ld      c, #0x30
        ld      a, #0xbb
        ldh     (_NR51_REG), a
        xor     a
        ldh     (_NR30_REG), a
        ld      a, (hl+)
        ldh     (c), a
        inc     c
        ld      a, (hl+)
        ldh     (c), a
        inc     c
        ld      a, (hl+)
        ldh     (c), a
        inc     c
        ld      a, (hl+)
        ldh     (c), a
        inc     c
        ld      a, (hl+)
        ldh     (c), a
        inc     c
        ld      a, (hl+)
        ldh     (c), a
        inc     c
        ld      a, (hl+)
        ldh     (c), a
        inc     c
        ld      a, (hl+)
        ldh     (c), a
        inc     c
        ld      a, (hl+)
        ldh     (c), a
        inc     c
        ld      a, (hl+)
        ldh     (c), a
        inc     c
        ld      a, (hl+)
        ldh     (c), a
        inc     c
        ld      a, (hl+)
        ldh     (c), a
        inc     c
        ld      a, (hl+)
        ldh     (c), a
        inc     c
        ld      a, (hl+)
        ldh     (c), a
        inc     c
        ld      a, (hl+)
        ldh     (c), a
        inc     c
        ld      a, (hl+)
        nop                     ; the ROM has these two too (0x0379)
        nop
        ldh     (c), a
        ld      a, #0x80
        ldh     (_NR30_REG), a
        ldh     a, (_TMA_REG)
        xor     b
        ldh     (_NR33_REG), a
        ld      a, #0x87
        ldh     (_NR34_REG), a
        ld      a, #0xff
        ldh     (_NR51_REG), a
    __endasm;

    /* Advance and write back, masking only the high byte. $C04E-$C057. */
    play_ptr += 16;
    play_ptr = ((uint16_t)((uint8_t)(play_ptr >> 8) & ptr_mask) << 8) | (uint8_t)play_ptr;

    frame_counter += 4;
    if (frame_counter == 0) {
        /* Slice boundary. $C061-$C087. A sync byte goes out on the link port
         * (SB is written with A, which is the counter, i.e. 0). */
        SB_REG = 0x00;
        SC_REG = 0x83;
        seq_step = (seq_step + 1) & 0x0F;
        /* `add a ; add a ; or $40` on the raw table byte. */
        play_ptr = (uint16_t)((uint8_t)(slice_tables[((table_sel & 0x0F) << 4) | seq_step] << 2) | 0x40) << 8;
        /* NR50 is left as it was on this frame. */
    } else {
        /* $C088-$C0B5. */
        if (envelope_on) {
            /* HL = step:counter, doubled 4-skip times; volume = ~H & 7. */
            uint16_t hl = ((uint16_t)seq_step << 8) | frame_counter;
            hl <<= (uint8_t)(4 - envelope_skip);
            a = ~(uint8_t)(hl >> 8) & 0x07;
            NR50_REG = (uint8_t)(a << 4) | a;
        } else {
            NR50_REG = 0x77;
        }
        /* Five more sync bytes, at counter 20, 40, 60, 80 and 100 -- frames
         * 5..25 of 64, so the six per slice are not evenly spaced. */
        a = frame_counter;
        if (a == 0x14 || a == 0x28 || a == 0x3C || a == 0x50 || a == 0x64) {
            SB_REG = 0x00;
            SC_REG = 0x83;
        }
    }

    BGP_REG = 0x00; /* $C0B9 */
}

ISR_VECTOR(VECTOR_TIMER, timer_isr)

/* ROM 0x0175: start (or restart) playback. Also the Start-to-resume path, so
 * it resets the sequencer and repeat depth but not the pointer or TMA. */
static void start_playback(void)
{
    TAC_REG = 0x06;  /* timer on, 65536 Hz */
    NR51_REG = 0x44; /* ch3 only, both sides */
    NR50_REG = 0x77;
    /* Ch1 is triggered with its DAC off -- inert, kept for fidelity. */
    NR12_REG = 0x00;
    NR13_REG = 0x00;
    NR14_REG = 0x80;
    NR32_REG = 0x20; /* ch3 at 100% */
    frame_counter = 0xFC;
    seq_step = 0x0F;
    repeat_depth = 1;
    /* The ROM also writes $01 to $2000 (an MBC bank select on a cart with
     * no MBC); harmless and omitted. */
    IF_REG = 0;
    IE_REG = VBL_IFLAG | TIM_IFLAG;
}

/* ROM 0x01B0: Start while playing. */
static void stop_playback(void)
{
    NR30_REG = 0x00;
    IE_REG = VBL_IFLAG;
}

/* ROM 0x0285: read the pad as [Start Select B A | Down Up Left Right]. */
static void read_joypad(void)
{
    uint8_t held = joypad();

    joy_pressed = (joy_held ^ held) & held;
    joy_held = held;

    /* Start forces the identity table. The ROM clears $C0CC first and then
     * stores the d-pad (0x02B8-0x02C5) and so does this: interrupts are on
     * here, so a slice-boundary IRQ landing in between plays one slice from
     * the identity table. Rare (a ~50-cycle window per frame), audible, and
     * the original's, so kept. */
    table_sel = 0;
    if (!(held & J_START))
        table_sel = held & 0x0F;

    /* 0x02C8: d-pad presses only count when no other direction was already
     * held -- adding a second direction to a held one is not an edge. */
    if ((joy_held ^ joy_pressed) & 0x0F)
        joy_pressed &= 0xF0;
}

/*
 * ROM 0x01BC, the VBlank handler. The original clears IE.0 and re-enables
 * interrupts so the timer can preempt it; running it from the main loop
 * after wait_vbl_done() gives the same preemption for free.
 */
static void vblank_logic(void)
{
    uint8_t v;

    read_joypad();

    /* Select + Up/Down: retune, every frame while held. TMA is clamped to
     * 1..$E1 (0x01DB `cp $e2`, 0x01E8 `dec a ; jr z`). */
    if (joy_held & J_SELECT) {
        if (joy_held & J_UP) {
            v = TMA_REG + 1;
            if (v < 0xE2) TMA_REG = v;
        }
        if (joy_held & J_DOWN) {
            v = TMA_REG - 1;
            if (v != 0) TMA_REG = v;
        }
    }

    /* B: the repeater. Down/Up presses set depth 1..3; the mask clears bit
     * depth-1 of the pointer's high byte. Without B the mask is $FF. 0x01EC.
     * $FF is stored first and the real mask after, as in the ROM, so an IRQ
     * in between plays one frame unfolded. */
    ptr_mask = 0xFF;
    if (joy_held & J_B) {
        if (joy_pressed & J_DOWN) {
            if (repeat_depth + 1 < 4) repeat_depth++;
        }
        if (joy_pressed & J_UP) {
            if (repeat_depth - 1 != 0) repeat_depth--;
        }
        ptr_mask = ~(uint8_t)(1 << (repeat_depth - 1));
    }

    /* A: the envelope. Left/Right presses move the skip count; Left stops
     * at 3, so the boot value of 4 cannot be got back. 0x0222. Off-then-on,
     * the same race as above. */
    envelope_on = 0;
    if (joy_held & J_A) {
        envelope_on = 1;
        if (joy_pressed & J_LEFT) {
            if (envelope_skip + 1 < 4) envelope_skip++;
        }
        if ((joy_pressed & J_RIGHT) && envelope_skip != 0)
            envelope_skip--;
    }

    /* Start pressed: 0x0262. Alone it toggles playback; with Select held it
     * toggles the NR33 inversion. Any other combination does nothing. */
    if (joy_pressed & J_START) {
        if (joy_held == J_START) {
            disable_interrupts();
            if (IE_REG & TIM_IFLAG)
                stop_playback();
            else
                start_playback();
            enable_interrupts();
        } else if (joy_held == (J_START | J_SELECT)) {
            nr33_xor ^= 0xFF;
        }
    }
}

void main(void)
{
    /* The original never touches the LCD and relies on the boot ROM leaving
     * it on. The ISR flips BGP between $FF and $00, so the screen is white
     * with black bands showing where the timer ISR runs; the tiles behind
     * that do not matter. */
    DISABLE_OAM_DMA; /* no sprites; keeps the VBlank ISR short */
    SHOW_BKG;
    DISPLAY_ON;

    NR52_REG = 0x80; /* the boot ROM leaves the APU on; GBDK's crt0 may not */

    disable_interrupts();
    TMA_REG = boot_tma;
    start_playback();
    enable_interrupts();

    while (1) {
        wait_vbl_done();
        vblank_logic();
    }
}
