import coremLogo from "../Logo/corem.png.jpg";

function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="site-container site-footer-inner">
        <div className="footer-copyright">
          <img src={coremLogo} alt="Corem" className="footer-logo" />
          <p className="mb-0">© {currentYear} Coren. All rights reserved.</p>
        </div>
        <p className="mb-0 footer-support">Need help? Contact your system administrator.</p>
      </div>
    </footer>
  );
}

export default Footer;
