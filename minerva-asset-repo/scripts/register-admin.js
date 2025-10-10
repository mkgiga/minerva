import fetch from 'node-fetch';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3001';
const ADMIN_EMAIL = process.env.DEBUG_ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.DEBUG_ADMIN_PASSWORD || 'admin123';
const ADMIN_USERNAME = process.env.DEBUG_ADMIN_USERNAME || 'admin';

async function registerAdmin() {
    console.log('🔧 Debug Script: Registering Admin User');
    console.log('====================================');
    
    try {
        const response = await fetch(`${API_BASE}/api/auth/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: ADMIN_EMAIL,
                password: ADMIN_PASSWORD,
                username: ADMIN_USERNAME
            })
        });

        const data = await response.json();

        if (response.ok) {
            console.log('✅ Admin user registered successfully!');
            console.log('📧 Email:', ADMIN_EMAIL);
            console.log('👤 Username:', data.user.username);
            console.log('🎭 Role:', data.user.role);
            console.log('🔑 User ID:', data.user._id);
            
            if (data.user.role === 'admin') {
                console.log('🎉 User automatically assigned admin role!');
                console.log('🔗 Admin Panel: http://localhost:3002');
            } else {
                console.log('⚠️  User was not assigned admin role.');
                console.log('💡 Make sure the email is in ADMIN_EMAILS environment variable.');
            }
            
            console.log('\n🔐 Login Credentials:');
            console.log(`Email: ${ADMIN_EMAIL}`);
            console.log(`Password: ${ADMIN_PASSWORD}`);
            
        } else {
            console.log('❌ Registration failed');
            console.log('Error:', data.message);
            
            if (data.message?.includes('already exists')) {
                console.log('\n💡 User already exists. You can login with:');
                console.log(`Email: ${ADMIN_EMAIL}`);
                console.log(`Password: ${ADMIN_PASSWORD}`);
                console.log('🔗 Admin Panel: http://localhost:3002');
            }
        }
        
    } catch (error) {
        console.log('💥 Network error occurred');
        console.log('Error:', error.message);
        console.log('\n🔍 Troubleshooting:');
        console.log('- Is the API server running on', API_BASE + '?');
        console.log('- Check if MongoDB is connected');
        console.log('- Try: docker-compose -f docker-compose.dev.yml up');
    }
}

// Check if running directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
    registerAdmin();
}

export default registerAdmin;