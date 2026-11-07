"use client";

import type { AutoAnimationPlugin } from "@formkit/auto-animate";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import type { ComponentProps } from "react";

/**
 * A <ul> whose children animate when the list changes under them: an item
 * that leaves slides out, the others close the gap. Entry is left to CSS
 * (.enter-stagger in globals.css) so a list arriving together can stagger.
 * Keyframes run through the Web Animations API, so they stay smooth while
 * the page re-renders. Reduced motion: no movement, instant.
 */
const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";
const DURATION = 180;

const listPlugin: AutoAnimationPlugin = (el, action, oldCoords, newCoords) => {
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let keyframes: Keyframe[] = [{ opacity: 1 }, { opacity: 1 }];
  if (!reduce && action === "remove") {
    keyframes = [
      { opacity: 1, transform: "translateX(0) scale(1)" },
      { opacity: 0, transform: "translateX(8px) scale(0.98)" },
    ];
  } else if (!reduce && action === "remain" && oldCoords && newCoords) {
    const dx = oldCoords.left - newCoords.left;
    const dy = oldCoords.top - newCoords.top;
    keyframes = [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }];
  }
  return new KeyframeEffect(el, keyframes, { duration: reduce ? 0 : DURATION, easing: EASE });
};

export function AnimatedUl(props: ComponentProps<"ul">) {
  const [ref] = useAutoAnimate<HTMLUListElement>(listPlugin);
  return <ul ref={ref} {...props} />;
}
