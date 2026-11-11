import {MIND_CHARACTERS} from '../domain/mind-game.mjs';
// Character identity stays attached to a mind. Motion receives observed account state.
const PHASES = new Set(['idle', 'sleep', 'observing', 'investing', 'clutch', 'attention']);
const PALETTES = ['blue', 'amber', 'violet', 'sage'].map(name => ['light', 'base', 'shade'].map(tone => 'var(--companion-' + name + '-' + tone + ')'));
const DISPLAY_SIZES = new Set(['compact', 'small', 'card', 'preview', 'large']);
const LEGACY_SIZES = { 48:'compact', 96:'small', 144:'card', 160:'preview', 192:'large' };
const BODIES = MIND_CHARACTERS.map(c=>c.id);
const COLORS = ['blue', 'amber', 'violet', 'sage'];
const EYES = new Set(['natural', 'focused', 'sleepy']);
const ACCESSORIES = new Set(['none', 'glasses', 'sunglasses', 'bowtie']);
let instance = 0;
export function mindAvatarIdentity(identity = '') {
  let seed = 2166136261;
  for (const point of String(identity)) seed = Math.imul(seed ^ point.codePointAt(0), 16777619) >>> 0;
  const variant = seed % 4;
  return { variant, palette: PALETTES[variant], seed, config: {
    bodyVariant: BODIES[variant], colorPalette: COLORS[variant], eyeVariant: 'natural',
    accessory: ['none', 'glasses', 'sunglasses', 'bowtie'][variant], motionIntensity: 'subtle',
  } };
}

export function renderMindAvatar({ identity = '', phase = 'idle', size = 'card', config = null } = {}) {
  const defaults = mindAvatarIdentity(identity);
  const appearance = config && typeof config === 'object' ? config : {};
  const variant = BODIES.includes(appearance.bodyVariant) ? BODIES.indexOf(appearance.bodyVariant) : defaults.variant;
  const paletteName = COLORS.includes(appearance.colorPalette) ? appearance.colorPalette : defaults.config.colorPalette;
  const seed = defaults.seed;
  const eyeVariant = EYES.has(appearance.eyeVariant) ? appearance.eyeVariant : defaults.config.eyeVariant;
  const accessoryName = ACCESSORIES.has(appearance.accessory) ? appearance.accessory : defaults.config.accessory;
  const motion = appearance.motionIntensity === 'off' ? 'off' : 'subtle';
  const state = PHASES.has(phase) ? phase : 'idle';
  const displaySize = DISPLAY_SIZES.has(size) ? size : LEGACY_SIZES[String(size)] || 'card';
  const id = `mind-avatar-${seed}-${++instance}`;
  const shapes = [
    'M40 77C29 58 44 32 65 34C73 22 97 23 104 39C126 40 135 64 122 80C130 103 115 124 94 119C76 132 51 123 49 108C30 103 26 87 40 77Z',
    'M58 41C65 22 89 22 101 43L128 94C139 119 115 133 95 124C84 120 77 120 65 125C42 133 23 115 34 92Z',
    'M80 45C56 14 27 34 29 61C31 88 54 120 80 132C107 120 130 86 131 61C132 34 102 14 80 45Z',
    'M40 64C24 37 49 22 65 39C73 37 87 37 96 39C113 22 137 39 120 64C140 84 130 116 108 121C93 131 65 130 50 120C27 111 21 83 40 64Z',
    'M38 68L35 24Q39 19 61 40Q80 33 101 40Q123 19 127 25L123 69Q142 103 115 122Q80 139 44 121Q20 103 38 68Z',
    'M48 58Q25 7 44 7Q59 9 66 48Q80 42 94 48Q102 8 117 7Q137 9 112 58Q139 74 130 102Q121 130 80 129Q39 130 30 102Q21 74 48 58Z',
  ];
  const eyes = eyeVariant === 'focused' ? '<path d="M59 68L71 71M89 71L101 68" fill="none" stroke="var(--companion-face)" stroke-width="var(--companion-stroke-focused)" stroke-linecap="round"/><ellipse cx="65" cy="75" rx="3.6" ry="4"/><ellipse cx="95" cy="75" rx="3.6" ry="4"/>' : variant === 3 && !['glasses', 'sunglasses'].includes(accessoryName) ? '<circle cx="57" cy="56" r="7"/><circle cx="104" cy="56" r="7"/>' : '<ellipse cx="65" cy="72" rx="4.3" ry="6.4"/><ellipse cx="95" cy="72" rx="4.3" ry="6.4"/>';
  const accessory = accessoryName === 'glasses' ? '<g class="mind-avatar-glasses" fill="none" stroke="var(--companion-glasses)" stroke-width="var(--companion-stroke-glasses)"><ellipse cx="64" cy="72" rx="11" ry="14"/><ellipse cx="96" cy="72" rx="11" ry="14"/><path d="M75 71Q80 68 85 71"/></g>' : accessoryName === 'sunglasses' ? '<g class="mind-avatar-glasses"><circle cx="62" cy="70" r="14" fill="var(--companion-sunglasses)"/><circle cx="98" cy="70" r="14" fill="var(--companion-sunglasses)"/><path d="M75 69Q80 65 85 69M45 67L38 64M115 67L122 64" fill="none" stroke="var(--companion-sunglasses)" stroke-width="var(--companion-stroke-sunglasses)"/><path d="M54 64L62 61M90 64L98 61" stroke="var(--companion-sunglasses-shine)" stroke-width="var(--companion-stroke-shine)" stroke-linecap="round"/></g>' : '';
  const neck = accessoryName === 'bowtie' ? '<path d="M66 105L79 111L94 105L94 120L80 114L66 121Z" fill="var(--companion-bowtie)"/><circle cx="80" cy="112" r="3" fill="var(--companion-bowtie-knot)"/>' : '';
  return `<span class="mind-avatar" data-mind-avatar="${variant}" data-phase="${state}" data-body="${BODIES[variant]}" data-palette="${paletteName}" data-eyes="${eyeVariant}" data-accessory="${accessoryName}" data-motion="${motion}" data-size="${displaySize}" aria-hidden="true"><svg viewBox="0 0 160 160" focusable="false" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="${id}-body" cx=".29" cy=".22" r=".88"><stop offset="0" stop-color="var(--companion-body-light)"/><stop offset=".52" stop-color="var(--companion-body-base)"/><stop offset="1" stop-color="var(--companion-body-shade)"/></radialGradient><radialGradient id="${id}-shine" cx=".3" cy=".15" r=".8"><stop offset="0" stop-color="var(--companion-shine)" stop-opacity="var(--companion-shine-opacity)"/><stop offset=".56" stop-color="var(--companion-shine)" stop-opacity="0"/><stop offset="1" stop-color="var(--companion-shine-shade)" stop-opacity="var(--companion-shade-opacity)"/></radialGradient><radialGradient id="${id}-shadow"><stop offset="0" stop-color="var(--companion-shadow)" stop-opacity="var(--companion-shadow-opacity)"/><stop offset="1" stop-color="var(--companion-shadow)" stop-opacity="0"/></radialGradient></defs><ellipse class="mind-avatar-shadow" cx="80" cy="144" rx="39" ry="7" fill="url(#${id}-shadow)"/><g class="mind-avatar-body"><ellipse class="mind-avatar-foot mind-avatar-foot-left" cx="58" cy="128" rx="13" ry="7" fill="var(--companion-body-shade)"/><ellipse class="mind-avatar-foot mind-avatar-foot-right" cx="102" cy="128" rx="13" ry="7" fill="var(--companion-body-shade)"/><path d="${shapes[variant]}" fill="url(#${id}-body)"/><path d="${shapes[variant]}" fill="url(#${id}-shine)"/><g class="mind-avatar-face"><g class="mind-avatar-eyes" fill="var(--companion-face)">${eyes}</g><g class="mind-avatar-sleep-eyes" stroke="var(--companion-sleep-eyes)" stroke-width="var(--companion-stroke-sleep)" stroke-linecap="round" fill="none"><path d="M59 73Q65 78 71 73M89 73Q95 78 101 73"/></g>${variant===4?'<g class="mind-avatar-whiskers" stroke="var(--companion-face)" stroke-width="1.5" opacity=".4"><path d="M40 83l14 3M39 92l15-2M106 86l14-3M106 90l15 2"/></g>':''}${accessory}<path class="mind-avatar-mouth" d="M76 87Q80 90 84 87" stroke="var(--companion-mouth)" stroke-opacity="var(--companion-mouth-opacity)" stroke-width="var(--companion-stroke-mouth)" stroke-linecap="round" fill="none"/>${neck}</g><ellipse class="mind-avatar-hand mind-avatar-hand-left" cx="39" cy="94" rx="10" ry="13" fill="var(--companion-body-base)"/><ellipse class="mind-avatar-hand mind-avatar-hand-right" cx="122" cy="94" rx="10" ry="13" fill="var(--companion-body-base)"/></g></svg></span>`;
}
