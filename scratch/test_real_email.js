const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: 'abbassultanli71@gmail.com',
    pass: 'qola uijf dzur ylwp'
  }
});

async function main() {
  console.log('Sending test email to abbas.sultanli@mail.ru...');
  try {
    const info = await transporter.sendMail({
      from: '"Abunəm" <abbassultanli71@gmail.com>',
      to: 'abbas.sultanli@mail.ru',
      subject: 'Abunəm - SMTP Connection Test ✔',
      text: 'Hello! This is a test email confirming that the SMTP server configuration is working perfectly!',
      html: '<b>Hello!</b> This is a test email confirming that the SMTP server configuration is working perfectly!'
    });
    console.log('Email sent successfully! Message ID:', info.messageId);
  } catch (error) {
    console.error('Failed to send email:', error);
  }
}

main();
