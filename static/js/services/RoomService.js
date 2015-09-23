(function(app) {
    app.factory('Room', function ($http) {
        return {
            getRooms : function() {
                return $http.get('/get_rooms');
            },
        }
    });
})(angular.module('RoomService', []));
