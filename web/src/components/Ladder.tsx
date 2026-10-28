import { RUNG_LADDER, rungColour } from "./Hoop";

/**
 *  dreamDEX exposes margin as four discrete states, so this draws four stops —
 *  not a continuous gauge. A smooth meter would imply a precision the venue
 *  does not publish, and the rung a watch fires at is one of these names.
 */
export function Ladder({ status }: { status: number }) {
  const at = Math.max(0, Math.min(3, status));
  return (
    <div className="ladder" role="group" aria-label={`Margin status: ${RUNG_LADDER[at]}`}>
      <div className="ladder-track" aria-hidden="true" />
      {RUNG_LADDER.map((name, i) => {
        const reached = i <= at;
        return (
          <div className={`ladder-stop${i === at ? " at" : ""}`} key={name}>
            <span
              className="ladder-dot"
              style={reached ? { background: rungColour(at), borderColor: rungColour(at) } : undefined}
            />
            <span className="ladder-name" style={i === at ? { color: rungColour(at) } : undefined}>
              {name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
