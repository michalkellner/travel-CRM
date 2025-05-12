require('dotenv').config();
var expressPackage = require("express");
var mysql = require("mysql2");
var app = expressPackage();
var exphbs = require("express-handlebars");

var path = require("path");

app.use(expressPackage.urlencoded({extended: true}));
app.use(expressPackage.json());

//tell express service to look in public folder for static files
app.use(expressPackage.static(path.join(__dirname, "public")));

// attach express handlebars package and tell it to look in the views folder
app.set("views", path.join(__dirname, "views"));

const db = mysql.createConnection({
	host: 'localhost',
	user: 'root',
	password: 'PolarPlunge',
	database: 'retreat_crm'
}).promise();

// connect to database (dont need when using promise)
// db.connect((err) => {
// 	if (err){
// 		console.error('Error connecting to MySQL:', err);
// 		return;
// 	}
// 	console.log('Connected to MySQL database');
// });

// Create a new customer & reservation:
app.post('/new-reservation', async (req, res) => {
	const {name, email, phone, num_guests} = req.body;
	const cust_query = "INSERT INTO customers (customer_name, email, phone_number) VALUES (?, ?, ?)";
	const res_query = "INSERT INTO bookings_general (customer_id, retreat_id, num_guests, total_price, status, retreat_date, meal_choices) VALUES (?, ?, ?, ?, ?, ?, ?)";
	try {
		const [customer] = await db.query(query, [name, email, phone]);

		const customerID = customer.customer_id;
		await db.query(res_query, [customerID, num_guests]);
		res.status(201).redirect('/show-customers');
	} catch (err) {
		console.error('Error creating customer:', err);
		res.status(500).json({message: 'Error creating customer'});
	}
});


// Search customers by:
app.get('/customers', async (req, res) => {
	const { name, email, phone } = req.query;

	let query = 'SELECT * FROM customers WHERE 1=1';
	const params = [];

	//Filter by partial name:
	if (name) {
		query += ' AND customer_name LIKE ?';
		params.push(`%${name}%`);
	}

	// Filter by email:
	if (email){
		query += ' AND email LIKE ?';
		params.push(`%${email}%`);
	}

	//Filter by phone number:
	if (phone){
		query += ' AND phone_number LIKE ?';
		params.push(`%${phone}%`);
	}

	try {
		const [results] = await db.query(query, params);
		res.json(results);
	} catch (err) {
		console.error('Error fetching customers:', err);
		res.status(500).json({message: 'Error fetching customers'});
	}
});

var hbs = exphbs.create({
	extname: ".hbs",
	defaultLayout: false,
	// helpers: require("./helpers") // use helpers to find partials
});

app.engine(".hbs", hbs.engine);
app.set("view engine", ".hbs");

app.get("/", function(req, res){
	res.render("home.hbs");
});

app.get("/new-customer-form", function(req, res){
	res.render("new-customer-form");
});

app.get("/show-customers", function(req, res){
	res.render("show-customers");
});



var port = process.env.PORT || 8080;
app.listen(port);
console.log("Express started. Listening on port %s", port);