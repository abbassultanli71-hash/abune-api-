const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, // true for 465
  auth: {
    user: 'abbassultanli71@gmail.com',
    pass: 'qola uijf dzur ylwp'
  }
});

async function main() {
  console.log('Sending test email via port 465 to abbas.sultanli@mail.ru...');
  try {
    const info = await transporter.sendMail({
      from: '"Abunəm" <abbassultanli71@gmail.com>',
      to: 'abbas.sultanli@mail.ru',
      subject: 'Abunəm - Port 465 Test ✔',
      text: 'Hello! This is a test email sent using port 465 (SSL).',
      html: '<b>Hello!</b> This is a test email sent using port 465 (SSL).'
    });
    console.log('Email sent successfully! Message ID:', info.messageId);
  } catch (error) {
    console.error('Failed to send email:', error);
  }
}

main();
