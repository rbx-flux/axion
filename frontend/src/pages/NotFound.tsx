import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div className="narrow">
      <section className="hero">
        <p className="eyebrow">404</p>
        <h1>Nothing in this orbit</h1>
        <p className="lede">
          That page does not exist. <Link to="/">Back to the start.</Link>
        </p>
      </section>
    </div>
  );
}
