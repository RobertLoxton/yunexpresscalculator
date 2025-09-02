// app/layout.jsx
import './globals.css';

export const metadata = {
  title: 'Packaging Box Designer',
  description: 'Dimensional weight calculator with 3D/SVG preview',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
