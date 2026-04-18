///<reference lib="dom"/>

export const findLinks = (): HTMLAnchorElement[] => [...document.querySelectorAll('a')];
