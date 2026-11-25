import { type CSSProperties, useState } from 'react';
import type { ProjectView } from '../../shared/api';
import { type LogoColor, letterOf } from '../../shared/projects';

export interface ProjectLogoProps {
  project: Pick<ProjectView, 'name' | 'logo' | 'logoUrl'>;
  size: number;
}

/** A project's logo: its image, or the first letter of its name on its color. Decorative: the name is always beside it. */
export function ProjectLogo({ project, size }: ProjectLogoProps) {
  // An image that can't be shown (its copy went missing) falls back to the letter.
  const [broken, setBroken] = useState<string | null>(null);
  const style = { '--logo-size': `${size}px` } as CSSProperties;
  if (project.logoUrl !== null && project.logoUrl !== broken) {
    return (
      <img
        className="project-logo"
        src={project.logoUrl}
        alt=""
        draggable={false}
        style={style}
        data-testid="project-logo"
        onError={() => setBroken(project.logoUrl)}
      />
    );
  }
  return <LetterLogo name={project.name} color={project.logo.kind === 'letter' ? project.logo.color : 'gray'} size={size} />;
}

/** The first letter of the name on a color. */
export function LetterLogo({ name, color, size }: { name: string; color: LogoColor; size: number }) {
  return (
    <span className="project-logo letter logo-color" data-color={color} style={{ '--logo-size': `${size}px` } as CSSProperties} aria-hidden="true">
      {letterOf(name)}
    </span>
  );
}
