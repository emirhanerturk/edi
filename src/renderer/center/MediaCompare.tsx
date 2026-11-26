import { type SyntheticEvent, useEffect, useState } from 'react';
import { mediaUrl } from '../../shared/media';
import { edi } from '../bridge';
import { fileSize } from '../format';
import type { MediaPair, MediaSide } from './media';

const duration = (seconds: number) => {
  if (!Number.isFinite(seconds)) return null;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** One version: what it is (before, after, new, deleted), its size and dimensions, and the image or video. */
function MediaFigure({ label, tone, side, media }: { label: string; tone: string; side: MediaSide; media: MediaPair['media'] }) {
  const src = mediaUrl(side.repoPath, side.path, side.version, side.rev ?? undefined);
  const [size, setSize] = useState<number | null>(null);
  const [shape, setShape] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void edi.mediaSize(side.repoPath, side.path, side.rev).then(
      (bytes) => live && setSize(bytes),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [side.repoPath, side.path, side.rev, side.version]);
  const meta = [shape, size === null ? null : fileSize(size)].filter(Boolean).join(' · ');
  const name = side.path.slice(side.path.lastIndexOf('/') + 1);
  const onImage = (event: SyntheticEvent<HTMLImageElement>) => setShape(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`);
  const onVideo = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    setShape([`${video.videoWidth} × ${video.videoHeight}`, duration(video.duration)].filter(Boolean).join(' · '));
  };
  return (
    <figure className={`media-figure ${tone}`} data-testid="media-figure">
      <figcaption className="media-caption">
        <span className="media-label">{label}</span>
        {meta !== '' && <span className="mono">{meta}</span>}
      </figcaption>
      <div className="media-frame">
        {failed === src ? (
          <span className="media-failed">{media === 'image' ? 'This image could not be shown' : 'This video could not be played'}</span>
        ) : media === 'image' ? (
          <img className="media-image" src={src} alt={`${name}, ${label.toLowerCase()}`} draggable={false} onLoad={onImage} onError={() => setFailed(src)} />
        ) : (
          <video className="media-video" src={src} controls preload="metadata" onLoadedMetadata={onVideo} onError={() => setFailed(src)} />
        )}
      </div>
    </figure>
  );
}

/** A changed image or video: before and after side by side; an added or deleted one alone, centered. */
export function MediaCompare({ pair, large = false }: { pair: MediaPair; large?: boolean }) {
  const { media, before, after } = pair;
  const className = `media-compare${large ? ' large' : ''}`;
  if (before && after) {
    return (
      <div className={`${className} two`} data-testid="media-compare">
        <MediaFigure label="BEFORE" tone="before" side={before} media={media} />
        <MediaFigure label="AFTER" tone="after" side={after} media={media} />
      </div>
    );
  }
  const side = after ?? before;
  if (!side) return null;
  return (
    <div className={`${className} one`} data-testid="media-compare">
      <MediaFigure label={after ? 'NEW' : 'DELETED'} tone={after ? 'new' : 'deleted'} side={side} media={media} />
    </div>
  );
}
