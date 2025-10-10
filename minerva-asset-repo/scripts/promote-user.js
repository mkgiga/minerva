import fetch from 'node-fetch';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3001';
const EMAIL = process.argv[2] || 'sourcemile@gmail.com';

async function promoteUserToAdmin() {
    console.log('🔧 Debug Script: Promoting User to Admin');
    console.log('=====================================');
    console.log('📧 Email:', EMAIL);
    
    try {
        // First, let's login as an admin to get a token (this won't work yet)
        // So we'll create a temporary direct database update via a special endpoint
        
        // For now, let's make a temporary endpoint that doesn't require auth
        const response = await fetch(`${API_BASE}/api/debug/promote-admin`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: EMAIL,
                secret: 'debug-promote-secret-123' // Simple protection
            })
        });

        const data = await response.json();

        if (response.ok) {
            console.log('✅ User promoted to admin successfully!');
            console.log('👤 Username:', data.user.username);
            console.log('🎭 Role:', data.user.role);
            console.log('🔗 Admin Panel: http://localhost:3002');
            
            console.log('\n🔐 Login Credentials:');
            console.log(`Email: ${EMAIL}`);
            console.log('Password: testing123');
            
        } else {
            console.log('❌ Promotion failed');
            console.log('Error:', data.message);
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
    promoteUserToAdmin();
}

export default promoteUserToAdmin;