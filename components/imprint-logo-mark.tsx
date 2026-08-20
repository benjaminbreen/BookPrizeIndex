type ImprintLogoMarkProps = {
  logoPath?: string;
  name: string;
  className?: string;
  imageClassName?: string;
  fallbackClassName?: string;
};

export function ImprintLogoMark({
  logoPath,
  name,
  className = "h-16 w-20",
  imageClassName = "h-full w-full object-contain grayscale",
  fallbackClassName = "font-[var(--font-mono)] text-lg plain-number muted",
}: ImprintLogoMarkProps) {
  const initial = name.trim()[0]?.toUpperCase() ?? "?";

  return (
    <span className={`grid shrink-0 place-items-center overflow-hidden ${className}`}>
      {logoPath ? (
        <img loading="lazy" decoding="async" alt="" aria-hidden="true" className={imageClassName} src={logoPath} />
      ) : (
        <span className={fallbackClassName}>{initial}</span>
      )}
    </span>
  );
}
