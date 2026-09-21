/** SVG ikonka yordamchisi (sprite `#i-<nom>` belgilariga murojaat qiladi). */
export function icon(name, className = 'ico') {
  return `<svg class="${className}" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;
}
