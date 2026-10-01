import type { SVGProps } from 'react';

const base = (p: SVGProps<SVGSVGElement>) => ({ width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...p });

export const IconPlus = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>;
export const IconSend = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 19V5M5 12l7-7 7 7" /></svg>;
export const IconMenu = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M3 6h18M3 12h18M3 18h18" /></svg>;
export const IconSidebar = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>;
export const IconSearch = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
export const IconDots = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>;
export const IconEdit = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>;
export const IconTrash = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>;
export const IconLogout = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>;
export const IconShield = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /></svg>;
export const IconGlobe = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" /></svg>;
export const IconCopy = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>;
export const IconCheck = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M20 6 9 17l-5-5" /></svg>;
export const IconPhone = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z" /></svg>;
export const IconAlert = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>;
export const IconStar = (p: SVGProps<SVGSVGElement>) => <svg {...base({ ...p, fill: 'currentColor', stroke: 'none' })}><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1Z" /></svg>;
export const IconClose = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M18 6 6 18M6 6l12 12" /></svg>;
export const IconChat = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" /></svg>;
