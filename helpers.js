module.exports = {
	partialHelper: function(id) {
		console.log("id from helper");
		console.log(id);
		if (id == "1") {return "proj1"};
		if (id == "2") {return "proj2"};
	}
}