// 공간감: the words a line's place is kept in, and where a voice with a side is at a moment.

// Sides other than the centre. The last three move while the line is said.
export const SIDES = [
  "left",
  "right",
  "left_to_right",
  "right_to_left",
  "back_and_forth",
];
export const MOVING_SIDES = SIDES.slice(2);
export const SPACES = ["close", "far", "muffled"];

// A crossing takes at least this long: a shorter line covers only part of the way, about the
// middle, so nobody darts across. Also the length taken for a line whose length isn't known.
const CROSS_SECONDS = 2.5;
// One whole turn of pacing: to one side, to the other and back.
const PACE_SECONDS = 5;

/**
 * Where a voice with `side` is, `seconds` into a line `length` seconds long: -1 (left) to 1
 * (right). A moving side starts and stops gently, as a person does.
 */
export function sideAt(side, seconds = 0, length = 0) {
  if (side === "left") return -1;
  if (side === "right") return 1;
  const at = Math.max(0, Number(seconds) || 0);
  if (side === "back_and_forth")
    return Math.sin((2 * Math.PI * at) / PACE_SECONDS);
  if (side !== "left_to_right" && side !== "right_to_left") return 0;
  const whole = Number.isFinite(length) && length > 0 ? length : CROSS_SECONDS;
  const across =
    -Math.cos(Math.PI * Math.min(1, at / whole)) *
    Math.min(1, whole / CROSS_SECONDS);
  return side === "left_to_right" ? across : -across;
}
