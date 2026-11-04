import "./edupath-brand.css";

/**
 * Shared homepage identity. The admin sign-in page links home; the admin workspace omits href to preserve navigation.
 * The mark is at most 210 CSS px wide: a 420 px WebP for screens up to 2x, 630 px for 3x phones, and the 420 px PNG
 * for a browser without WebP (public/ASSETS.md).
 */
export default function EduPathBrand({ href, light = false }: { href?: string; light?: boolean }) {
  const content = <picture>
    <source type="image/webp" srcSet="/edupath-logo-420.webp 420w, /edupath-logo-630.webp 630w" sizes="210px" />
    <img src="/edupath-logo.png" width="420" height="140" alt="EduPath AI — AI đồng hành · Học tập bứt phá" />
  </picture>;
  const className = `ep-brand${light ? " ep-brand-light" : ""}`;
  return href ? <a className={className} href={href} aria-label="EduPath AI — Trang chủ">{content}</a> : <div className={className}>{content}</div>;
}
