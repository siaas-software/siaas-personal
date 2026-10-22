import type { CSSProperties } from "react";

// Mascot markup and styling from davideabbatiello/siaas-public-site.
// Keep the public site's robot, including its hand-and-stars mark, available offline.
function SiaasMark({ className = "" }: { className?: string }) {
  return (
    <span className={`siaas-mark ${className}`} aria-hidden="true">
      <svg viewBox="0 0 120 92">
        <path
          className="siaas-hand"
          d="M12 62 C31 43 43 43 59 54 C70 61 80 62 91 53"
        />
        <path className="siaas-hand" d="M52 73 C68 80 82 77 108 53" />
        <path
          className="siaas-spark"
          d="M61 5 C64 18 69 23 82 26 C69 29 64 34 61 47 C58 34 53 29 40 26 C53 23 58 18 61 5Z"
        />
        <path
          className="siaas-spark"
          d="M91 20 C93 27 96 30 103 32 C96 34 93 37 91 44 C89 37 86 34 79 32 C86 30 89 27 91 20Z"
        />
      </svg>
    </span>
  );
}

export function AssistantMascot({ size = 44 }: { size?: number }) {
  return (
    <div
      className="assistant-mascot"
      aria-hidden="true"
      style={
        {
          width: (size * 190) / 248,
          height: size,
          "--mascot-scale": size / 248,
          "--mascot-top": `${(size * 8) / 248}px`,
        } as CSSProperties
      }
    >
      <div className="siaas-bot mascot-3d">
        <span className="bot-antenna" />
        <div className="bot-head">
          <i />
          <i />
        </div>
        <div className="bot-body">
          <SiaasMark className="bot-logo" />
        </div>
        <span className="bot-arm bot-arm-left" />
        <span className="bot-arm bot-arm-right" />
      </div>
    </div>
  );
}
