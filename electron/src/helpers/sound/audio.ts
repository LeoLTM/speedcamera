/**
 * Utility function to play sound effects
 */
export const playSound = (soundFile: string) => {
    const audio = new Audio(soundFile);
    audio.play().catch(err => console.error('Error playing sound:', err));
};

/**
 * This does not work right now
 */
export const playBeepSound = () => {
    // playSound(beepSound);
}