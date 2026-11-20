import { useState } from 'react';

export function AccountAvatar({
  name,
  avatarUrl,
  className,
}: {
  name?: string;
  avatarUrl?: string;
  className: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showPhoto = Boolean(avatarUrl && failedUrl !== avatarUrl);

  return (
    <span className={`${className} account-avatar`} aria-hidden="true">
      <span>{(name || '?')[0]?.toUpperCase()}</span>
      {showPhoto && (
        <img
          className="account-avatar-image"
          src={avatarUrl}
          alt=""
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(avatarUrl!)}
        />
      )}
    </span>
  );
}
