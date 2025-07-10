require('dotenv').config();
var expressPackage = require("express");
var mysql = require("mysql2");

var exphbs = require("express-handlebars");
const Handlebars = require("handlebars");
var app = expressPackage();

// Register the "json" helper
Handlebars.registerHelper('json', function (context) {
	return JSON.stringify(context, null, 2); // Pretty print with 2-space indentation
  });

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

// when creating new reservation, get necessary info
app.get('/new-customer-form', async (req, res) => {
	const [retreats] = await db.query('SELECT * FROM retreats');

	// Convert meal options from JSON string to array
	const formattedRetreats = retreats.map(r => {
		let parsedMeals = [];
		try {
			parsedMeals = typeof r.meal_options === 'string'
			? JSON.parse(r.meal_options)
			: r.meal_options || [];
		} catch (err) {
			console.error(`Failed to parse meal_options for retreat_id ${r.retreat_id}:`, err.message);
		}
		return {
			...r,
			meal_options: parsedMeals
		};
	});

	res.render('new-customer-form', {
		retreats: formattedRetreats
	});
});

app.get('/new-retreat-form', (req, res) => {
	res.render('new-retreat-form');
});

//Create a new retreat:
app.post('/new-retreat', async (req, res) => {
	const { retreat_name, start_date, length, meal_options_input, room_types} = req.body;

	// Convert meal options to JSON string
	const mealOptionsArray = meal_options_input.split(',').map(option => option.trim()).filter(option => option !== '');

	const retreat_query = "INSERT INTO retreats (retreat_name, start_date, length) VALUES (?, ?, ?)";
	const room_options_query = "INSERT INTO room_options (retreat_id, room_name, price, capacity, inventory) VALUES (?, ?, ?, ?, ?)";
	const meal_choices_query = "INSERT INTO meal_choices (retreat_id, meal_name) VALUES (?, ?)";

	try {
		// Insert the retreat into the retreats table
		const [retreatResult] = await db.query(retreat_query, [retreat_name, start_date, length]);

		const retreatID = retreatResult.insertId; // Get the ID of the newly created retreat

		// Insert each room type into the room_options table with the retreat ID
		if (Array.isArray(room_types) && room_types.length > 0) {
			for (const room of room_types) {
				const { room_name, price, capacity, inventory } = room;

				await db.query(room_options_query, [retreatID, room_name, price, capacity, inventory]);
			}
		}

		// Insert each meal option into the meal_choices table with the retreat ID
		if (Array.isArray(mealOptionsArray) && mealOptionsArray.length > 0) {
			for (const mealOption of mealOptionsArray) {
				await db.query(meal_choices_query, [retreatID, mealOption]);
			}
		}
	
		// Redirect to the show-retreats page after successful creation
		console.log('Retreat created successfully:', retreat_name);
		res.status(201).redirect('/show-retreats');
	} catch (err) {
		console.error('Error creating retreat or room or meal options:', err);
		res.status(500).json({message: 'Error creating retreat or room or meal options'});
	}
});

// Create a new customer & reservation:
app.post('/new-reservation', async (req, res) => {
	const {name, email, phone, retreat_id, start_date, num_guests, meal_choices, rooms, total_price, special_requests} = req.body;
	const cust_query = "INSERT INTO customers (customer_name, email, phone_number) VALUES (?, ?, ?)";
	const res_query = "INSERT INTO bookings_general (customer_id, retreat_id, num_guests, total_price, status, retreat_date, special_requests) VALUES (?, ?, ?, ?, ?, ?, ?)";
	const room_query = "INSERT INTO bookings_rooms (booking_id, room_type_id, customer_id) VALUES (?, ?, ?)";
	const meal_query = "INSERT INTO bookings_meals (booking_id, customer_id, meal_choice_id) VALUES (?, ?, ?)";
	const update_inventory_query = "UPDATE room_options SET inventory = inventory - 1 WHERE room_type_id = ?";
	try {
		// Insert the new customer into the customers table
		const [customer] = await db.query(cust_query, [name, email, phone]);

		//Get the ID of the newly created customer
		const customerID = customer.insertId;

		// Insert the new reservation into the bookings_general table
		const [booking] = await db.query(res_query, [customerID, retreat_id, num_guests, total_price, 'awaiting call', start_date, special_requests]);

		// Get the ID of the newly created booking
		const bookingID = booking.insertId;

		// Insert the room choices into the bookings_rooms table
		if (Array.isArray(rooms) && rooms.length > 0) {
			for (const room of rooms) { // assuming rooms is an array of room type IDs
				await db.query(room_query, [bookingID, room, customerID]);
				// update the inventory of the room type
				await db.query(update_inventory_query, [room]);
			}
		}

		// Insert the meal choices into the bookings_meals table
		if (Array.isArray(meal_choices) && meal_choices.length > 0) {
			for (const meal of meal_choices) { // assuming meal_choices is an array of meal choice IDs
				await db.query(meal_query, [bookingID, customerID, meal]);
			}
		}
		
		// Send confirmation email
		const mailOptions = {
			from: process.env.EMAIL, // Your email address
			to: email, // Customer's email address
			subject: 'Booking Confirmation',
			text: `Dear ${name}, \n\nThanks for signing up!`
		};

		await transporter.sendMail(mailOptions);
		console.log('Confirmation email sent to:', email);

		res.status(201).redirect('/show-customers');
	} catch (err) {
		console.error('Error creating customer:', err);
		res.status(500).json({message: 'Error creating customer'});
	}
});

// get all retreats
app.get('/show-retreats', async (req, res) => {
	const [retreats] = await db.query('SELECT * FROM retreats');

	const formattedRetreats = retreats.map(r => ({
		...r
	}));

	res.render('show-retreats', { retreats: formattedRetreats });
});

// get room options for a specific retreat
app.get('/room-options/:retreat_id', async (req, res) => {
	const {retreat_id} = req.params;

	try {
		const [rooms] = await db.query('SELECT * FROM room_options WHERE retreat_id = ?', [retreat_id]);
		res.json(rooms);
	} catch (err) {
		console.error('Error fetching room options:', err);
		res.status(500).json({message: 'Error fetching room options'});
	}
});

//get meal options for a specific retreat
app.get('/meal-options/:retreat_id', async (req, res) => {
	const {retreat_id} = req.params;

	try {
		const [meals] = await db.query('SELECT * FROM meal_choices WHERE retreat_id = ?', [retreat_id]);
		res.json(meals);
	} catch (err) {
		console.error('Error fetching meal options:', err);
		res.status(500).json({message: 'Error fetching meal options'});
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

Handlebars.registerHelper('json', function (context) {
	return JSON.stringify(context, null, 2);
});

Handlebars.registerHelper('formatDate', function (dateString) {
	const date = new Date(dateString);
	return date.toLocaleDateString('en-US', {
	  weekday: 'long',
	  year: 'numeric',
	  month: 'long',
	  day: 'numeric'
	});
  });
  
Handlebars.registerHelper('isFutureDate', function(dateString) {
    const today = new Date();
    const date = new Date(dateString);
    return date > today; // Returns true if the date is in the future
});

Handlebars.registerHelper('eq', function (a, b) {
    return a === b;
});

Handlebars.registerHelper('formatDateForInput', function (dateString) {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-based
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
});

Handlebars.registerHelper('includes', function (array, value) {
    return Array.isArray(array) && array.includes(value);
});

var hbs = exphbs.create({
	extname: ".hbs",
	defaultLayout: false,
	handlebars: Handlebars
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

// Retreat Dashboard Route
app.get('/retreat-dashboard/:retreat_id', async (req, res) => {
    const { retreat_id } = req.params;

    try {
        // Fetch retreat details
        const [retreatDetails] = await db.query('SELECT * FROM retreats WHERE retreat_id = ?', [retreat_id]);

        // Fetch room options for the retreat
        const [roomOptions] = await db.query('SELECT * FROM room_options WHERE retreat_id = ?', [retreat_id]);

        // Fetch meal options for the retreat and the number of times each meal is chosen from the bookings_meals table
		// Note: Assuming meal_choices table has a column 'meal_name' for meal names
		// and bookings_meals table has a column 'meal_choice_id' that references meal_choices
		const [mealOptions] = await db.query(`
			SELECT 
				mc.meal_name, 
				COUNT(bm.meal_choice_id) AS meal_count
			FROM meal_choices mc
			LEFT JOIN bookings_meals bm ON mc.meal_id = bm.meal_choice_id
			WHERE mc.retreat_id = ?
			GROUP BY mc.meal_id, mc.meal_name
		`, [retreat_id]);

		// Fetch customer details, number of guests, number of rooms, and total price they are paying
		const [customers] = await db.query(`
			SELECT
				c.customer_name,
				c.email,
				bg.num_guests,
				COUNT(br.booked_room_id) AS num_rooms,
				bg.total_price
			FROM customers c
			INNER JOIN bookings_general bg ON c.customer_id = bg.customer_id
			LEFT JOIN bookings_rooms br ON bg.booking_id = br.booking_id AND bg.retreat_id = ?
			WHERE bg.retreat_id = ?
			GROUP BY c.customer_id, bg.num_guests, bg.total_price
		`, [retreat_id, retreat_id]);

		// Fetch booked rooms for the retreat
		const [bookedRooms] = await db.query(`
			SELECT
				ro.room_name,
				c.customer_name,
				ro.capacity
			FROM bookings_rooms br
			INNER JOIN room_options ro ON br.room_type_id = ro.room_type_id
			INNER JOIN customers c ON br.customer_id = c.customer_id
			WHERE ro.retreat_id = ?
		`, [retreat_id]);

        // Render the retreat dashboard with the fetched data
        res.render('retreat-dashboard', {
            retreat: retreatDetails[0],
            rooms: roomOptions,
            meals: mealOptions,
			customers: customers,
			bookedRooms: bookedRooms
        });
    } catch (err) {
        console.error('Error fetching retreat details:', err);
        res.status(500).json({ message: 'Error fetching retreat details' });
    }
});

// Customer Dashboard Route
app.get('/customer-dashboard/:customer_id', async (req, res) => {
    const { customer_id } = req.params;

    try {
        // Fetch customer details
        const [customerDetails] = await db.query('SELECT * FROM customers WHERE customer_id = ?', [customer_id]);

        // Fetch all customer_ids where the email matches the given customer_id's email
        const [matchingCustomers] = await db.query('SELECT customer_id FROM customers WHERE email = ?', [customerDetails[0].email]);

        // Extract customer IDs
        const customerIds = matchingCustomers.map(c => c.customer_id);

        // Fetch bookings, rooms, and meals for all customer IDs
        const bookingDetails = await Promise.all(
            customerIds.map(async (id) => {
                // Fetch bookings for the current customer ID
                const [bookings] = await db.query(`
                    SELECT 
                        bg.booking_id,
                        r.retreat_name,
                        bg.retreat_date,
                        bg.num_guests,
                        bg.total_price,
						bg.status
                    FROM bookings_general bg
                    INNER JOIN retreats r ON bg.retreat_id = r.retreat_id
                    WHERE bg.customer_id = ?
                `, [id]);
				
                // Fetch rooms and meals for each booking
                const detailedBookings = await Promise.all(
                    bookings.map(async (booking) => {
                        const [rooms] = await db.query(`
                            SELECT 
                                ro.room_name,
                                ro.price,
                                ro.capacity
                            FROM bookings_rooms br
                            INNER JOIN room_options ro ON br.room_type_id = ro.room_type_id
                            WHERE br.booking_id = ?
                        `, [booking.booking_id]);

                        const [meals] = await db.query(`
                            SELECT 
                                mc.meal_name,
                                COUNT(bm.meal_choice_id) AS meal_count
                            FROM bookings_meals bm
                            INNER JOIN meal_choices mc ON bm.meal_choice_id = mc.meal_id
                            WHERE bm.booking_id = ?
                            GROUP BY mc.meal_id, mc.meal_name
                        `, [booking.booking_id]);
						
						const [specialRequestsResult] = await db.query(`
							SELECT special_requests
							FROM bookings_general
							WHERE booking_id = ?
						`, [booking.booking_id]);

						const special_requests = specialRequestsResult.length > 0 ? specialRequestsResult[0].special_requests : null;

                        return {
                            ...booking,
                            rooms,
                            meals,
							special_requests
                        };
                    })
                );

                return detailedBookings;
            })
        );

        // Flatten the array of arrays into a single array of bookings
        const allBookings = bookingDetails.flat();

		//Sort bookings by retreat_date in descending order
		allBookings.sort((a,b) => new Date(b.retreat_date) - new Date(a.retreat_date));

        // Render the customer dashboard with the fetched data
        res.render('customer-dashboard', {
            customer: customerDetails[0],
            bookings: allBookings
        });
    } catch (err) {
        console.error('Error fetching customer details:', err);
        res.status(500).json({ message: 'Error fetching customer details' });
    }
});

// Edit Booking Route
app.get('/edit-booking/:booking_id', async (req, res) => {
    const { booking_id } = req.params;

    try {
        // Fetch booking details
        const [bookingDetails] = await db.query(`
            SELECT
                bg.booking_id,
                c.customer_name,
                c.email,
                c.phone_number,
                r.retreat_name,
				r.retreat_id,
                bg.retreat_date,
                bg.num_guests,
                bg.total_price,
                bg.special_requests,
                bg.status
            FROM bookings_general bg
            INNER JOIN customers c ON bg.customer_id = c.customer_id
            INNER JOIN retreats r ON bg.retreat_id = r.retreat_id
            WHERE bg.booking_id = ?
        `, [booking_id]);

        if (bookingDetails.length === 0) {
            return res.status(404).json({ message: 'Booking not found' });
        }

        // Fetch room options for the retreat
        const [roomOptions] = await db.query('SELECT * FROM room_options WHERE retreat_id = ?', [bookingDetails[0].retreat_id]);
        console.log('Room Options:', roomOptions);

        // Fetch meal options for the retreat
        const [mealOptions] = await db.query(`
            SELECT 
                mc.meal_name, 
                mc.meal_id
            FROM meal_choices mc
            WHERE mc.retreat_id = ?
        `, [bookingDetails[0].retreat_id]);
        console.log('Meal Options:', mealOptions);

        // Fetch selected rooms for the booking
        const [selectedRooms] = await db.query(`
            SELECT 
                ro.room_type_id
            FROM bookings_rooms br
            INNER JOIN room_options ro ON br.room_type_id = ro.room_type_id
            WHERE br.booking_id = ?
        `, [booking_id]);
        console.log('Selected Rooms:', selectedRooms);

        // Fetch selected meals for the booking
        const [selectedMeals] = await db.query(`
            SELECT
                mc.meal_id
            FROM bookings_meals bm
            INNER JOIN meal_choices mc ON bm.meal_choice_id = mc.meal_id
            WHERE bm.booking_id = ?
        `, [booking_id]);
        console.log('Selected Meals:', selectedMeals);

        // Render the edit booking form with the fetched data
        res.render('edit-booking', {
            booking: bookingDetails[0],
            roomOptions: roomOptions,
            mealOptions: mealOptions,
            selectedRooms: selectedRooms.map(r => r.room_type_id),
            selectedMeals: selectedMeals.map(m => m.meal_id)
        });
    } catch (err) {
        console.error('Error fetching booking details:', err);
        res.status(500).json({ message: 'Error fetching booking details' });
    }
});

// Update Booking Route
app.post('/update-booking/:booking_id', async (req, res) => {
    const { booking_id } = req.params;
    const { retreat_date, num_guests, status, rooms, meal_choices, special_requests } = req.body;

    try {
        // Update the booking details
        await db.query(`
            UPDATE bookings_general
            SET retreat_date = ?, num_guests = ?, status = ?, special_requests = ?
            WHERE booking_id = ?
        `, [retreat_date, num_guests, status, special_requests, booking_id]);

        // Update the rooms for the booking
        await db.query('DELETE FROM bookings_rooms WHERE booking_id = ?', [booking_id]);
        if (Array.isArray(rooms) && rooms.length > 0) {
            for (const room of rooms) {
                await db.query('INSERT INTO bookings_rooms (booking_id, room_type_id) VALUES (?, ?)', [booking_id, room]);
            }
        }

        // Update the meal choices for the booking
        await db.query('DELETE FROM bookings_meals WHERE booking_id = ?', [booking_id]);
        if (Array.isArray(meal_choices) && meal_choices.length > 0) {
            for (const meal of meal_choices) {
                await db.query('INSERT INTO bookings_meals (booking_id, meal_choice_id) VALUES (?, ?)', [booking_id, meal]);
            }
        }

        res.redirect(`/customer-dashboard/${req.body.customer_id}`);
    } catch (err) {
        console.error('Error updating booking:', err);
        res.status(500).json({ message: 'Error updating booking' });
    }
});

const nodemailer = require('nodemailer');

//Create a transporter object
const transporter = nodemailer.createTransport({
	host: 'smtp.gmail.com',
	port: 587, //TODO check if this is the right port
	secure: false,
	auth: {
		user: process.env.EMAIL, // Your email address
		pass: process.env.PASSWORD // Your email password or app password
	}
});

// Verify the transporter
transporter.verify((error, success) => {
	if (error) {
		console.error('Error verifying transporter:', error);
	} else {
		console.log('Nodemailer transporter is ready');
	}
});

app.post('/update-template/:template_id', async (req, res) => {
	const { template_id } = req.params;
	const { template_name, body } = req.body;

	try {
		await db.query(`
			UPDATE email_templates
			SET template_name = ?, body = ?
			WHERE template_id = ?
		`, [template_name, body, template_id]);

		res.redirect('/manage-templates');
	} catch (err) {
		console.error('Error updating email template:', err);
		res.status(500).json({ message: 'Error updating email template' });
	}
});

var port = process.env.PORT || 8080;
app.listen(port);
console.log("Express started. Listening on port %s", port);