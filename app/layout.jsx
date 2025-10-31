export const metadata = { title: 'Recepty', description: 'Sdílený katalog receptů' };
export default function RootLayout({ children }) {
  return (
    <html lang="cs">
      <body style={{fontFamily:'system-ui', background:'#fafafa', margin:0}}>{children}</body>
    </html>
  );
}
