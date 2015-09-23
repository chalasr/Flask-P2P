(function (app) {
    app.run(function($rootScope) {
        $rootScope.messages = [];
    });
})(angular.module('app', ['MainCtrl', 'RoomService'], function($interpolateProvider) {
    $interpolateProvider.startSymbol('<%');
    $interpolateProvider.endSymbol('%>');
}));
