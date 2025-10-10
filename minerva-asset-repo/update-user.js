print("Updating user role to admin...");
const result = db.users.updateOne(
  {email: "sourcemile@gmail.com"}, 
  {$set: {role: "admin"}}
);
print("Update result:", JSON.stringify(result));

// Verify the update
const user = db.users.findOne({email: "sourcemile@gmail.com"});
print("User role is now:", user.role);