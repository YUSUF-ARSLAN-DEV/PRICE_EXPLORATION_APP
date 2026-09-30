import Link from 'next/link';

export default function NotFound() {
  return (
    <div>
      <h1>404</h1>
      <p>
        <Link href="/">Home / الرئيسية</Link>
      </p>
    </div>
  );
}
