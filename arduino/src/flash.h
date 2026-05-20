#pragma once

// Non-blocking flash — for lap timer mode.
// GPIO goes HIGH immediately; the main-loop tick turns it LOW after flashTime ms.
// Lap timing precision is unaffected because this call returns in <1 µs.
void startNonBlockingFlash();

// Blocking flash — for speed camera mode (host-coordinated).
void flashLED();
