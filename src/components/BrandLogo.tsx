/**
 * BrandLogo — the Asaan Caption logo (microphone mark + wordmark images),
 * for places that build their own header: the landing page and the sign-in
 * pages. Sized in theme-minimal.css (.brand-logo).
 */
export function BrandLogo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`brand-logo brand-logo-${size}`}>
      <img src="/logo-mark.png" alt="" className="brand-logo-img-mark" />
      <img src="/logo-wordmark.png" alt="Asaan Caption" className="brand-logo-img-word" />
    </span>
  );
}
